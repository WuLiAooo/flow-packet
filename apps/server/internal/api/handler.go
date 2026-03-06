package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/flow-packet/server/internal/parser"
)

// ConnState 单个连接的隔离状态, 持有该连接专属的 Proto 文件和路由映射
type ConnState struct {
	ProtoDir      string
	ParseResult   *parser.ParseResult
	RouteMappings map[uint32]RouteMapping
}

// AppState 应用状态, 在各 handler 间共享
type AppState struct {
	DataDir      string // 数据根目录
	TemplateFile string // 模板 JSON 文件路径(全局共享)
	mu           sync.RWMutex
	connections  map[string]*ConnState
}

// connIDRe 校验 connectionId 格式, 防止路径穿越
var connIDRe = regexp.MustCompile(`^conn_\d+_[a-z0-9]+$`)

// GetConnState 获取指定连接的隔离状态, 不存在则自动创建并解析已有 proto 文件
//
// 参数：
//   - connID: 连接 ID, 需匹配 conn_{数字}_{小写字母数字} 格式
//
// 返回值：
//   - *ConnState: 连接状态; connID 非法时返回 nil
func (s *AppState) GetConnState(connID string) *ConnState {
	if !connIDRe.MatchString(connID) {
		return nil
	}

	s.mu.RLock()
	cs, ok := s.connections[connID]
	s.mu.RUnlock()
	if ok {
		return cs
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// 双重检查
	if cs, ok = s.connections[connID]; ok {
		return cs
	}

	protoDir := filepath.Join(s.DataDir, "connections", connID, "proto")
	os.MkdirAll(protoDir, 0755)

	cs = &ConnState{
		ProtoDir:      protoDir,
		RouteMappings: make(map[uint32]RouteMapping),
	}

	// 解析已有 proto 文件
	if result, err := parser.ParseProtoDir(protoDir); err == nil && len(result.Files) > 0 {
		cs.ParseResult = result
	}

	s.connections[connID] = cs
	return cs
}

// FrameField 协议帧字段定义
type FrameField struct {
	Name    string `json:"name"`
	Bytes   int    `json:"bytes"`
	IsRoute bool   `json:"isRoute,omitempty"`
	IsSeq   bool   `json:"isSeq,omitempty"`
}

// FrameTemplate 自定义协议帧模板
type FrameTemplate struct {
	ID        string       `json:"id"`
	Name      string       `json:"name"`
	Fields    []FrameField `json:"fields"`
	ByteOrder string       `json:"byteOrder,omitempty"`
}

// RouteMapping route 值到 message 名称的映射
type RouteMapping struct {
	Route       uint32 `json:"route"`
	RequestMsg  string `json:"requestMsg"`
	ResponseMsg string `json:"responseMsg"`
}

// NewAppState 创建应用状态
//
// 参数：
//   - dataDir: 数据根目录, 模板文件存储在此目录下, 连接数据按 connectionId 隔离
//
// 返回值：
//   - *AppState: 初始化完成的应用状态
func NewAppState(dataDir string) *AppState {
	return &AppState{
		DataDir:      dataDir,
		TemplateFile: filepath.Join(dataDir, "templates.json"),
		connections:  make(map[string]*ConnState),
	}
}

// RegisterHandlers 注册所有 API handlers
func RegisterHandlers(srv *Server, state *AppState) {
	// HTTP 路由
	srv.HandleHTTP("POST /api/proto/upload", makeProtoUploadHandler(state, srv))

	// WebSocket action 路由
	srv.Handle("proto.list", makeProtoListHandler(state))
	srv.Handle("route.list", makeRouteListHandler(state))
	srv.Handle("route.set", makeRouteSetHandler(state))
	srv.Handle("route.delete", makeRouteDeleteHandler(state))
	srv.Handle("template.list", makeTemplateListHandler(state))
	srv.Handle("template.save", makeTemplateSaveHandler(state))
	srv.Handle("template.delete", makeTemplateDeleteHandler(state))
}

// makeProtoUploadHandler 创建 Proto 文件上传处理函数
func makeProtoUploadHandler(state *AppState, srv *Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		connID := r.URL.Query().Get("connectionId")
		if connID == "" {
			writeJSONError(w, http.StatusBadRequest, "connectionId is required")
			return
		}
		cs := state.GetConnState(connID)
		if cs == nil {
			writeJSONError(w, http.StatusBadRequest, "invalid connectionId")
			return
		}

		if err := r.ParseMultipartForm(32 << 20); err != nil {
			writeJSONError(w, http.StatusBadRequest, "failed to parse form")
			return
		}

		files := r.MultipartForm.File["files"]
		if len(files) == 0 {
			writeJSONError(w, http.StatusBadRequest, "no files uploaded")
			return
		}

		// 前端通过 paths 字段发送每个文件的相对路径(与 files 一一对应)
		paths := r.MultipartForm.Value["paths"]

		// 清空旧文件, 避免残留文件干扰解析
		os.RemoveAll(cs.ProtoDir)
		os.MkdirAll(cs.ProtoDir, 0755)

		// 保存文件(保留子目录结构)
		for i, fh := range files {
			// 优先使用 paths 字段的相对路径, 回退到 fh.Filename
			saveName := fh.Filename
			if i < len(paths) && paths[i] != "" {
				saveName = paths[i]
			}

			// 清理路径, 防止目录穿越
			cleanName := filepath.Clean(saveName)
			if strings.Contains(cleanName, "..") {
				writeJSONError(w, http.StatusBadRequest, fmt.Sprintf("invalid path: %s", saveName))
				return
			}
			if filepath.Ext(cleanName) != ".proto" {
				writeJSONError(w, http.StatusBadRequest, fmt.Sprintf("invalid file type: %s", saveName))
				return
			}

			src, err := fh.Open()
			if err != nil {
				writeJSONError(w, http.StatusInternalServerError, "failed to open file")
				return
			}

			dstPath := filepath.Join(cs.ProtoDir, cleanName)
			// 创建子目录
			if dir := filepath.Dir(dstPath); dir != "." {
				os.MkdirAll(dir, 0755)
			}

			dst, err := os.Create(dstPath)
			if err != nil {
				src.Close()
				writeJSONError(w, http.StatusInternalServerError, "failed to save file")
				return
			}

			io.Copy(dst, src)
			src.Close()
			dst.Close()
		}

		// 解析整个 protoDir 下所有 proto 文件
		result, err := parser.ParseProtoDir(cs.ProtoDir)
		if err != nil {
			errMsg := err.Error()
			// 提取缺失的依赖路径, 帮助用户定位问题
			missing := extractMissingImports(errMsg)
			if len(missing) > 0 {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]any{
					"error":          fmt.Sprintf("parse error: %v", err),
					"missingImports": missing,
				})
				return
			}
			writeJSONError(w, http.StatusBadRequest, fmt.Sprintf("parse error: %v", err))
			return
		}

		cs.ParseResult = result

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"files":    result.Files,
			"messages": result.AllMessages(),
		})
	}
}

// makeProtoListHandler 创建 proto.list 处理函数
func makeProtoListHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		var req struct {
			ConnectionID string `json:"connectionId"`
		}
		if err := json.Unmarshal(payload, &req); err != nil || req.ConnectionID == "" {
			return map[string]any{
				"files":    []any{},
				"messages": []any{},
			}, nil
		}

		cs := state.GetConnState(req.ConnectionID)
		if cs == nil || cs.ParseResult == nil {
			return map[string]any{
				"files":    []any{},
				"messages": []any{},
			}, nil
		}
		return map[string]any{
			"files":    cs.ParseResult.Files,
			"messages": cs.ParseResult.AllMessages(),
		}, nil
	}
}

// makeRouteListHandler 创建 route.list 处理函数
func makeRouteListHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		var req struct {
			ConnectionID string `json:"connectionId"`
		}
		if err := json.Unmarshal(payload, &req); err != nil || req.ConnectionID == "" {
			return map[string]any{"routes": []any{}}, nil
		}

		cs := state.GetConnState(req.ConnectionID)
		if cs == nil {
			return map[string]any{"routes": []any{}}, nil
		}

		routes := make([]RouteMapping, 0, len(cs.RouteMappings))
		for _, rm := range cs.RouteMappings {
			routes = append(routes, rm)
		}
		return map[string]any{"routes": routes}, nil
	}
}

// makeRouteSetHandler 创建 route.set 处理函数
func makeRouteSetHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		var req struct {
			ConnectionID string `json:"connectionId"`
			RouteMapping
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}
		if req.Route == 0 {
			return nil, fmt.Errorf("route cannot be 0")
		}
		if req.ConnectionID == "" {
			return nil, fmt.Errorf("connectionId is required")
		}

		cs := state.GetConnState(req.ConnectionID)
		if cs == nil {
			return nil, fmt.Errorf("invalid connectionId")
		}

		cs.RouteMappings[req.Route] = req.RouteMapping
		return map[string]string{"status": "ok"}, nil
	}
}

// makeRouteDeleteHandler 创建 route.delete 处理函数
func makeRouteDeleteHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		var req struct {
			ConnectionID string `json:"connectionId"`
			Route        uint32 `json:"route"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}
		if req.ConnectionID == "" {
			return nil, fmt.Errorf("connectionId is required")
		}

		cs := state.GetConnState(req.ConnectionID)
		if cs == nil {
			return nil, fmt.Errorf("invalid connectionId")
		}

		delete(cs.RouteMappings, req.Route)
		return map[string]string{"status": "ok"}, nil
	}
}

// readTemplates 从文件读取模板列表, 文件不存在时返回空列表
func readTemplates(path string) ([]FrameTemplate, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []FrameTemplate{}, nil
		}
		return nil, err
	}
	var templates []FrameTemplate
	if err := json.Unmarshal(data, &templates); err != nil {
		return nil, err
	}
	return templates, nil
}

// writeTemplates 将模板列表写入文件
func writeTemplates(path string, templates []FrameTemplate) error {
	data, err := json.MarshalIndent(templates, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

// makeTemplateListHandler 创建 template.list 处理函数
func makeTemplateListHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		templates, err := readTemplates(state.TemplateFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read templates: %w", err)
		}
		return map[string]any{"templates": templates}, nil
	}
}

// makeTemplateSaveHandler 创建 template.save 处理函数
func makeTemplateSaveHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		var req struct {
			Name      string       `json:"name"`
			Fields    []FrameField `json:"fields"`
			ByteOrder string       `json:"byteOrder,omitempty"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}
		if req.Name == "" {
			return nil, fmt.Errorf("name is required")
		}
		if len(req.Fields) == 0 {
			return nil, fmt.Errorf("fields cannot be empty")
		}

		templates, err := readTemplates(state.TemplateFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read templates: %w", err)
		}

		tpl := FrameTemplate{
			ID:        fmt.Sprintf("custom_%d", time.Now().UnixMilli()),
			Name:      req.Name,
			Fields:    req.Fields,
			ByteOrder: req.ByteOrder,
		}
		templates = append(templates, tpl)

		if err := writeTemplates(state.TemplateFile, templates); err != nil {
			return nil, fmt.Errorf("failed to save templates: %w", err)
		}
		return map[string]any{"template": tpl}, nil
	}
}

// makeTemplateDeleteHandler 创建 template.delete 处理函数
func makeTemplateDeleteHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		var req struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}
		if req.ID == "" {
			return nil, fmt.Errorf("id is required")
		}

		templates, err := readTemplates(state.TemplateFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read templates: %w", err)
		}

		filtered := make([]FrameTemplate, 0, len(templates))
		for _, t := range templates {
			if t.ID != req.ID {
				filtered = append(filtered, t)
			}
		}

		if err := writeTemplates(state.TemplateFile, filtered); err != nil {
			return nil, fmt.Errorf("failed to save templates: %w", err)
		}
		return map[string]string{"status": "ok"}, nil
	}
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// missingImportRe 匹配 protocompile 的 "could not resolve path" 错误
var missingImportRe = regexp.MustCompile(`could not resolve path "([^"]+)"`)

// extractMissingImports 从编译错误中提取缺失的 import 路径
func extractMissingImports(errMsg string) []string {
	matches := missingImportRe.FindAllStringSubmatch(errMsg, -1)
	if len(matches) == 0 {
		return nil
	}
	seen := make(map[string]bool)
	var result []string
	for _, m := range matches {
		path := m[1]
		if !seen[path] {
			seen[path] = true
			result = append(result, path)
		}
	}
	return result
}
