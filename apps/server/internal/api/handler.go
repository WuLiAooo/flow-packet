package api

import (
	"bytes"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/flow-packet/server/internal/parser"
	"github.com/flow-packet/server/internal/thriftparser"
)

type ConnState struct {
	CollectionFile string
	RouteFile      string
	ParseResult    *parser.ParseResult
	ThriftResult   *thriftparser.ParseResult
	RouteMappings  map[string]RouteMapping
}
type AppState struct {
	DataDir                 string
	SchemaDir               string
	TemplateFile            string
	CollectionFile          string
	CollectionMigrationFile string
	ParseResult             *parser.ParseResult
	ThriftResult            *thriftparser.ParseResult
	mu                      sync.RWMutex
	connections             map[string]*ConnState
	collectionsMigrated     bool
}

var connIDRe = regexp.MustCompile(`^conn_\d+_[a-z0-9]+$`)

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
	if cs, ok = s.connections[connID]; ok {
		return cs
	}

	connDir := filepath.Join(s.DataDir, "connections", connID)
	_ = os.MkdirAll(connDir, 0755)
	routeFile := filepath.Join(connDir, "routes.json")
	cs = &ConnState{
		CollectionFile: filepath.Join(connDir, "collections.json"),
		RouteFile:      routeFile,
		RouteMappings:  make(map[string]RouteMapping),
		ParseResult:    s.ParseResult,
		ThriftResult:   s.ThriftResult,
	}
	if routes, err := readRouteMappings(routeFile); err == nil {
		for _, rm := range routes {
			cs.RouteMappings[rm.Key()] = rm
		}
	}

	s.connections[connID] = cs
	return cs
}

func loadSchemaDir(dir string) (*parser.ParseResult, *thriftparser.ParseResult, error) {
	var hasProto bool
	var hasThrift bool

	err := filepath.Walk(dir, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() {
			return nil
		}
		switch strings.ToLower(filepath.Ext(path)) {
		case ".proto":
			hasProto = true
		case ".thrift":
			hasThrift = true
		}
		return nil
	})
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil, nil
		}
		return nil, nil, err
	}

	if hasProto && hasThrift {
		return nil, nil, fmt.Errorf("mixed proto and thrift files are not supported")
	}
	if hasProto {
		result, err := parser.ParseProtoDir(dir)
		return result, nil, err
	}
	if hasThrift {
		result, err := thriftparser.ParseThriftDir(dir)
		return nil, result, err
	}
	return nil, nil, nil
}

type FrameField struct {
	Name    string `json:"name"`
	Bytes   int    `json:"bytes"`
	IsRoute bool   `json:"isRoute,omitempty"`
	IsSeq   bool   `json:"isSeq,omitempty"`
}
type FrameTemplate struct {
	ID        string       `json:"id"`
	Name      string       `json:"name"`
	Fields    []FrameField `json:"fields"`
	ByteOrder string       `json:"byteOrder,omitempty"`
}
type RouteMapping struct {
	Route       uint32 `json:"route"`
	StringRoute string `json:"stringRoute,omitempty"`
	RequestMsg  string `json:"requestMsg"`
	ResponseMsg string `json:"responseMsg"`
}

type GameAPIInfo struct {
	Cmd            string            `json:"cmd"`
	Params         map[string]string `json:"params"`
	ReturnType     string            `json:"returnType"`
	Comment        string            `json:"comment"`
	ClassDeclaring string            `json:"classDeclaring"`
}

type gameAPIExecuteResult struct {
	RawText    string `json:"rawText"`
	Parsed     any    `json:"parsed,omitempty"`
	StatusCode int    `json:"statusCode"`
}

type gameAPIConfigFile struct {
	API struct {
		Endpoint string `json:"endpoint"`
		Password string `json:"password"`
		AuthKey  string `json:"auth_key"`
		URL      string `json:"url"`
	} `json:"api"`
}

type gameAPIClientConfig struct {
	User     string
	Password string
	AuthKey  string
	URL      string
}

func (rm RouteMapping) Key() string {
	if rm.StringRoute != "" {
		return rm.StringRoute
	}
	return fmt.Sprintf("%d", rm.Route)
}
func NewAppState(dataDir string) *AppState {
	state := &AppState{
		DataDir:                 dataDir,
		SchemaDir:               filepath.Join(dataDir, "schema"),
		TemplateFile:            filepath.Join(dataDir, "templates.json"),
		CollectionFile:          filepath.Join(dataDir, "collections.json"),
		CollectionMigrationFile: filepath.Join(dataDir, "collections.migrated"),
		connections:             make(map[string]*ConnState),
	}
	state.loadSharedSchema()
	return state
}

type schemaFileData struct {
	RelativePath string
	Content      []byte
}

func (s *AppState) loadSharedSchema() {
	if err := os.MkdirAll(s.SchemaDir, 0755); err != nil {
		return
	}

	hasSchemaFiles, err := schemaDirHasEntries(s.SchemaDir)
	if err != nil {
		return
	}
	if hasSchemaFiles {
		if protoResult, thriftResult, err := loadSchemaDir(s.SchemaDir); err == nil {
			s.ParseResult = protoResult
			s.ThriftResult = thriftResult
		}
		return
	}

	if protoResult, thriftResult, err := migrateLegacySchema(filepath.Join(s.DataDir, "connections"), s.SchemaDir); err == nil {
		s.ParseResult = protoResult
		s.ThriftResult = thriftResult
	}
}

func (s *AppState) getSharedSchemaResults() (*parser.ParseResult, *thriftparser.ParseResult) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.ParseResult, s.ThriftResult
}

func (s *AppState) setSharedSchemaResults(protoResult *parser.ParseResult, thriftResult *thriftparser.ParseResult) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.ParseResult = protoResult
	s.ThriftResult = thriftResult
	for _, cs := range s.connections {
		cs.ParseResult = protoResult
		cs.ThriftResult = thriftResult
	}
}

func schemaDirHasEntries(dir string) (bool, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	return len(entries) > 0, nil
}

func migrateLegacySchema(connectionRoot string, schemaDir string) (*parser.ParseResult, *thriftparser.ParseResult, error) {
	files, err := collectLegacySchemaFiles(connectionRoot)
	if err != nil {
		return nil, nil, err
	}
	if len(files) == 0 {
		return nil, nil, nil
	}
	if err := rewriteSchemaDir(schemaDir, files); err != nil {
		return nil, nil, err
	}
	return loadSchemaDir(schemaDir)
}

func collectLegacySchemaFiles(connectionRoot string) ([]schemaFileData, error) {
	entries, err := os.ReadDir(connectionRoot)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	fileMap := make(map[string]schemaFileData)
	schemaExt := ""
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		legacySchemaDir := filepath.Join(connectionRoot, entry.Name(), "proto")
		if _, err := os.Stat(legacySchemaDir); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}

		err = filepath.Walk(legacySchemaDir, func(path string, info os.FileInfo, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if info.IsDir() {
				return nil
			}

			ext := strings.ToLower(filepath.Ext(path))
			if ext != ".proto" && ext != ".thrift" {
				return nil
			}
			if schemaExt == "" {
				schemaExt = ext
			} else if schemaExt != ext {
				return fmt.Errorf("mixed proto and thrift schema files are not supported")
			}

			relPath, err := filepath.Rel(legacySchemaDir, path)
			if err != nil {
				return err
			}
			relPath = filepath.ToSlash(relPath)

			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}

			if existing, ok := fileMap[relPath]; ok {
				if !bytes.Equal(existing.Content, data) {
					return fmt.Errorf("conflicting legacy schema file: %s", relPath)
				}
				return nil
			}

			fileMap[relPath] = schemaFileData{
				RelativePath: relPath,
				Content:      data,
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}

	if len(fileMap) == 0 {
		return nil, nil
	}

	files := make([]schemaFileData, 0, len(fileMap))
	for _, file := range fileMap {
		files = append(files, file)
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].RelativePath < files[j].RelativePath
	})
	return files, nil
}

func rewriteSchemaDir(dir string, files []schemaFileData) error {
	if err := os.RemoveAll(dir); err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	for _, file := range files {
		targetPath := filepath.Join(dir, filepath.FromSlash(file.RelativePath))
		if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(targetPath, file.Content, 0644); err != nil {
			return err
		}
	}
	return nil
}
func RegisterHandlers(srv *Server, state *AppState) {
	srv.HandleHTTP("POST /api/proto/upload", makeProtoUploadHandler(state, srv))
	srv.Handle("proto.list", makeProtoListHandler(state))
	srv.Handle("route.list", makeRouteListHandler(state))
	srv.Handle("route.set", makeRouteSetHandler(state))
	srv.Handle("route.delete", makeRouteDeleteHandler(state))
	srv.Handle("template.list", makeTemplateListHandler(state))
	srv.Handle("template.save", makeTemplateSaveHandler(state))
	srv.Handle("template.delete", makeTemplateDeleteHandler(state))
	srv.Handle("collection.list", makeCollectionListHandler(state))
	srv.Handle("collection.get", makeCollectionGetHandler(state))
	srv.Handle("collection.save", makeCollectionSaveHandler(state))
	srv.Handle("collection.update", makeCollectionUpdateHandler(state))
	srv.Handle("collection.rename", makeCollectionRenameHandler(state))
	srv.Handle("collection.delete", makeCollectionDeleteHandler(state))
	srv.Handle("collection.folder.create", makeCollectionFolderCreateHandler(state))
	srv.Handle("collection.folder.rename", makeCollectionFolderRenameHandler(state))
	srv.Handle("collection.folder.delete", makeCollectionFolderDeleteHandler(state))
	srv.Handle("collection.folder.move", makeCollectionFolderMoveHandler(state))
	srv.Handle("collection.move", makeCollectionMoveHandler(state))
	srv.Handle("gameapi.list", makeGameAPIListHandler())
	srv.Handle("gameapi.execute", makeGameAPIExecuteHandler())
	srv.Handle("configRoot.scan", makeConfigRootScanHandler())
	srv.Handle("configGroup.files", makeConfigGroupFilesHandler())
	srv.Handle("configDocument.open", makeConfigDocumentOpenHandler())
	srv.Handle("configDocument.rows", makeConfigDocumentRowsHandler())
	srv.Handle("configDocument.save", makeConfigDocumentSaveHandler())
}
func makeProtoUploadHandler(state *AppState, srv *Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		connID := r.URL.Query().Get("connectionId")
		if connID != "" && state.GetConnState(connID) == nil {
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

		paths := r.MultipartForm.Value["paths"]

		os.RemoveAll(state.SchemaDir)
		os.MkdirAll(state.SchemaDir, 0755)

		var schemaExt string
		for i, fh := range files {
			saveName := fh.Filename
			if i < len(paths) && paths[i] != "" {
				saveName = paths[i]
			}

			cleanName := filepath.Clean(saveName)
			if strings.Contains(cleanName, "..") {
				writeJSONError(w, http.StatusBadRequest, fmt.Sprintf("invalid path: %s", saveName))
				return
			}

			ext := strings.ToLower(filepath.Ext(cleanName))
			if ext != ".proto" && ext != ".thrift" {
				writeJSONError(w, http.StatusBadRequest, fmt.Sprintf("invalid file type: %s", saveName))
				return
			}
			if schemaExt == "" {
				schemaExt = ext
			} else if schemaExt != ext {
				writeJSONError(w, http.StatusBadRequest, "mixed proto and thrift uploads are not supported")
				return
			}

			src, err := fh.Open()
			if err != nil {
				writeJSONError(w, http.StatusInternalServerError, "failed to open file")
				return
			}

			dstPath := filepath.Join(state.SchemaDir, cleanName)
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

		protoResult, thriftResult, err := loadSchemaDir(state.SchemaDir)
		if err != nil {
			errMsg := err.Error()
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

		state.setSharedSchemaResults(protoResult, thriftResult)

		var filesResp any = []any{}
		var messagesResp any = []any{}
		if protoResult != nil {
			filesResp = protoResult.Files
			messagesResp = protoResult.AllMessages()
		} else if thriftResult != nil {
			filesResp = thriftResult.Files
			messagesResp = thriftResult.AllMessages()
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"files":    filesResp,
			"messages": messagesResp,
		})
	}
}
func makeProtoListHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		protoResult, thriftResult := state.getSharedSchemaResults()
		if protoResult != nil {
			return map[string]any{
				"files":    protoResult.Files,
				"messages": protoResult.AllMessages(),
			}, nil
		}
		if thriftResult != nil {
			return map[string]any{
				"files":    thriftResult.Files,
				"messages": thriftResult.AllMessages(),
			}, nil
		}
		return map[string]any{
			"files":    []any{},
			"messages": []any{},
		}, nil
	}
}

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
func makeRouteSetHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		var req struct {
			ConnectionID string `json:"connectionId"`
			RouteMapping
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}
		if req.Route == 0 && req.StringRoute == "" {
			return nil, fmt.Errorf("route cannot be empty")
		}
		if req.ConnectionID == "" {
			return nil, fmt.Errorf("connectionId is required")
		}

		cs := state.GetConnState(req.ConnectionID)
		if cs == nil {
			return nil, fmt.Errorf("invalid connectionId")
		}

		cs.RouteMappings[req.RouteMapping.Key()] = req.RouteMapping
		if err := writeRouteMappings(cs.RouteFile, cs.RouteMappings); err != nil {
			return nil, fmt.Errorf("failed to save routes: %w", err)
		}
		return map[string]string{"status": "ok"}, nil
	}
}
func makeRouteDeleteHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		var req struct {
			ConnectionID string `json:"connectionId"`
			Route        uint32 `json:"route"`
			StringRoute  string `json:"stringRoute"`
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

		key := req.StringRoute
		if key == "" {
			key = fmt.Sprintf("%d", req.Route)
		}
		delete(cs.RouteMappings, key)
		if err := writeRouteMappings(cs.RouteFile, cs.RouteMappings); err != nil {
			return nil, fmt.Errorf("failed to save routes: %w", err)
		}
		return map[string]string{"status": "ok"}, nil
	}
}
func readRouteMappings(path string) ([]RouteMapping, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []RouteMapping{}, nil
		}
		return nil, err
	}
	var routes []RouteMapping
	if err := json.Unmarshal(data, &routes); err != nil {
		return nil, err
	}
	return routes, nil
}
func writeRouteMappings(path string, mappings map[string]RouteMapping) error {
	routes := make([]RouteMapping, 0, len(mappings))
	for _, rm := range mappings {
		routes = append(routes, rm)
	}
	data, err := json.MarshalIndent(routes, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
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
func writeTemplates(path string, templates []FrameTemplate) error {
	data, err := json.MarshalIndent(templates, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
func makeTemplateListHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		templates, err := readTemplates(state.TemplateFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read templates: %w", err)
		}
		return map[string]any{"templates": templates}, nil
	}
}
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

type CollectionFolder struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	ParentID  string `json:"parentId"`
	CreatedAt int64  `json:"createdAt"`
}
type CollectionItem struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	FolderID  string          `json:"folderId"`
	Nodes     json.RawMessage `json:"nodes"`
	Edges     json.RawMessage `json:"edges"`
	CreatedAt int64           `json:"createdAt"`
	UpdatedAt int64           `json:"updatedAt"`
}
type CollectionData struct {
	Folders []CollectionFolder `json:"folders"`
	Items   []CollectionItem   `json:"items"`
}

type CollectionItemSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	FolderID  string `json:"folderId"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

type CollectionListData struct {
	Folders []CollectionFolder      `json:"folders"`
	Items   []CollectionItemSummary `json:"items"`
}

func makeCollectionListData(col *CollectionData) *CollectionListData {
	if col == nil {
		return &CollectionListData{
			Folders: []CollectionFolder{},
			Items:   []CollectionItemSummary{},
		}
	}

	items := make([]CollectionItemSummary, 0, len(col.Items))
	for _, item := range col.Items {
		items = append(items, CollectionItemSummary{
			ID:        item.ID,
			Name:      item.Name,
			FolderID:  item.FolderID,
			CreatedAt: item.CreatedAt,
			UpdatedAt: item.UpdatedAt,
		})
	}

	return &CollectionListData{
		Folders: col.Folders,
		Items:   items,
	}
}

func emptyCollectionData() *CollectionData {
	return &CollectionData{
		Folders: []CollectionFolder{},
		Items:   []CollectionItem{},
	}
}
func readCollections(path string) (*CollectionData, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return emptyCollectionData(), nil
		}
		return nil, err
	}
	var col CollectionData
	if err := json.Unmarshal(data, &col); err != nil {
		return nil, err
	}
	if col.Folders == nil {
		col.Folders = []CollectionFolder{}
	}
	if col.Items == nil {
		col.Items = []CollectionItem{}
	}
	return &col, nil
}
func writeCollections(path string, col *CollectionData) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(col, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
func makeUniqueCollectionID(base string, exists map[string]struct{}) string {
	if base == "" {
		base = "collection"
	}
	if _, ok := exists[base]; !ok {
		return base
	}
	for i := 1; ; i++ {
		candidate := fmt.Sprintf("%s_%d", base, i)
		if _, ok := exists[candidate]; !ok {
			return candidate
		}
	}
}
func mergeCollections(dst, src *CollectionData) bool {
	if dst == nil || src == nil {
		return false
	}
	if dst.Folders == nil {
		dst.Folders = []CollectionFolder{}
	}
	if dst.Items == nil {
		dst.Items = []CollectionItem{}
	}

	changed := false
	folderIDs := make(map[string]struct{}, len(dst.Folders))
	folderByID := make(map[string]CollectionFolder, len(dst.Folders))
	for _, folder := range dst.Folders {
		folderIDs[folder.ID] = struct{}{}
		folderByID[folder.ID] = folder
	}

	folderIDMap := make(map[string]string, len(src.Folders))
	newFolders := make([]CollectionFolder, 0, len(src.Folders))
	for _, folder := range src.Folders {
		if existing, ok := folderByID[folder.ID]; ok && existing.Name == folder.Name && existing.ParentID == folder.ParentID && existing.CreatedAt == folder.CreatedAt {
			folderIDMap[folder.ID] = folder.ID
			continue
		}
		copied := folder
		copied.ID = makeUniqueCollectionID(folder.ID, folderIDs)
		folderIDMap[folder.ID] = copied.ID
		folderIDs[copied.ID] = struct{}{}
		newFolders = append(newFolders, copied)
		changed = true
	}
	for i := range newFolders {
		if mappedParentID, ok := folderIDMap[newFolders[i].ParentID]; ok {
			newFolders[i].ParentID = mappedParentID
		}
		dst.Folders = append(dst.Folders, newFolders[i])
	}

	itemIDs := make(map[string]struct{}, len(dst.Items))
	itemByID := make(map[string]CollectionItem, len(dst.Items))
	for _, item := range dst.Items {
		itemIDs[item.ID] = struct{}{}
		itemByID[item.ID] = item
	}
	for _, item := range src.Items {
		mappedFolderID := item.FolderID
		if value, ok := folderIDMap[item.FolderID]; ok {
			mappedFolderID = value
		}
		if existing, ok := itemByID[item.ID]; ok && existing.Name == item.Name && existing.FolderID == mappedFolderID && string(existing.Nodes) == string(item.Nodes) && string(existing.Edges) == string(item.Edges) && existing.CreatedAt == item.CreatedAt && existing.UpdatedAt == item.UpdatedAt {
			continue
		}
		copied := item
		copied.ID = makeUniqueCollectionID(item.ID, itemIDs)
		copied.FolderID = mappedFolderID
		itemIDs[copied.ID] = struct{}{}
		dst.Items = append(dst.Items, copied)
		changed = true
	}

	return changed
}
func (s *AppState) ensureGlobalCollectionsMigrated() error {
	s.mu.RLock()
	if s.collectionsMigrated {
		s.mu.RUnlock()
		return nil
	}
	s.mu.RUnlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.collectionsMigrated {
		return nil
	}

	if _, err := os.Stat(s.CollectionMigrationFile); err == nil {
		s.collectionsMigrated = true
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("failed to check collection migration marker: %w", err)
	}

	globalCollections, err := readCollections(s.CollectionFile)
	if err != nil {
		return fmt.Errorf("failed to read global collections: %w", err)
	}

	changed := false
	connectionRoot := filepath.Join(s.DataDir, "connections")
	entries, err := os.ReadDir(connectionRoot)
	if err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("failed to scan connection collections: %w", err)
		}
	} else {
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			legacyFile := filepath.Join(connectionRoot, entry.Name(), "collections.json")
			if _, err := os.Stat(legacyFile); err != nil {
				if os.IsNotExist(err) {
					continue
				}
				return fmt.Errorf("failed to inspect legacy collections for %s: %w", entry.Name(), err)
			}
			legacyCollections, err := readCollections(legacyFile)
			if err != nil {
				return fmt.Errorf("failed to read legacy collections for %s: %w", entry.Name(), err)
			}
			if mergeCollections(globalCollections, legacyCollections) {
				changed = true
			}
		}
	}

	if changed {
		if err := writeCollections(s.CollectionFile, globalCollections); err != nil {
			return fmt.Errorf("failed to write global collections: %w", err)
		}
	}
	if err := os.MkdirAll(s.DataDir, 0755); err != nil {
		return fmt.Errorf("failed to ensure data directory: %w", err)
	}
	if err := os.WriteFile(s.CollectionMigrationFile, []byte(time.Now().Format(time.RFC3339Nano)), 0644); err != nil {
		return fmt.Errorf("failed to write collection migration marker: %w", err)
	}

	s.collectionsMigrated = true
	return nil
}
func getCollectionFile(state *AppState, payload json.RawMessage) (string, error) {
	var base struct {
		ConnectionID string `json:"connectionId"`
	}
	if err := json.Unmarshal(payload, &base); err != nil {
		return "", fmt.Errorf("invalid payload: %w", err)
	}
	if base.ConnectionID == "" {
		return "", fmt.Errorf("connectionId is required")
	}
	if state.GetConnState(base.ConnectionID) == nil {
		return "", fmt.Errorf("invalid connectionId: %s", base.ConnectionID)
	}
	if err := state.ensureGlobalCollectionsMigrated(); err != nil {
		return "", err
	}
	return state.CollectionFile, nil
}
func makeCollectionListHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		colFile, err := getCollectionFile(state, payload)
		if err != nil {
			return nil, err
		}
		col, err := readCollections(colFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read collections: %w", err)
		}
		return makeCollectionListData(col), nil
	}
}
func makeCollectionGetHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		colFile, err := getCollectionFile(state, payload)
		if err != nil {
			return nil, err
		}
		var req struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}
		if req.ID == "" {
			return nil, fmt.Errorf("id is required")
		}

		col, err := readCollections(colFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read collections: %w", err)
		}
		for _, item := range col.Items {
			if item.ID == req.ID {
				return map[string]any{"item": item}, nil
			}
		}
		return nil, fmt.Errorf("collection not found: %s", req.ID)
	}
}
func makeCollectionSaveHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		colFile, err := getCollectionFile(state, payload)
		if err != nil {
			return nil, err
		}
		var req struct {
			Name     string          `json:"name"`
			FolderID string          `json:"folderId"`
			Nodes    json.RawMessage `json:"nodes"`
			Edges    json.RawMessage `json:"edges"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}
		if req.Name == "" {
			return nil, fmt.Errorf("name is required")
		}

		col, err := readCollections(colFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read collections: %w", err)
		}

		now := time.Now().UnixMilli()
		item := CollectionItem{
			ID:        fmt.Sprintf("col_%d", now),
			Name:      req.Name,
			FolderID:  req.FolderID,
			Nodes:     req.Nodes,
			Edges:     req.Edges,
			CreatedAt: now,
			UpdatedAt: now,
		}
		col.Items = append(col.Items, item)

		if err := writeCollections(colFile, col); err != nil {
			return nil, fmt.Errorf("failed to save collections: %w", err)
		}
		return map[string]any{"item": item}, nil
	}
}
func makeCollectionUpdateHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		colFile, err := getCollectionFile(state, payload)
		if err != nil {
			return nil, err
		}
		var req struct {
			ID    string          `json:"id"`
			Nodes json.RawMessage `json:"nodes"`
			Edges json.RawMessage `json:"edges"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}
		if req.ID == "" {
			return nil, fmt.Errorf("id is required")
		}

		col, err := readCollections(colFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read collections: %w", err)
		}

		found := false
		for i, item := range col.Items {
			if item.ID == req.ID {
				col.Items[i].Nodes = req.Nodes
				col.Items[i].Edges = req.Edges
				col.Items[i].UpdatedAt = time.Now().UnixMilli()
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("collection not found: %s", req.ID)
		}

		if err := writeCollections(colFile, col); err != nil {
			return nil, fmt.Errorf("failed to save collections: %w", err)
		}
		return map[string]string{"status": "ok"}, nil
	}
}
func makeCollectionRenameHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		colFile, err := getCollectionFile(state, payload)
		if err != nil {
			return nil, err
		}
		var req struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}
		if req.ID == "" || req.Name == "" {
			return nil, fmt.Errorf("id and name are required")
		}

		col, err := readCollections(colFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read collections: %w", err)
		}

		found := false
		for i, item := range col.Items {
			if item.ID == req.ID {
				col.Items[i].Name = req.Name
				col.Items[i].UpdatedAt = time.Now().UnixMilli()
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("collection not found: %s", req.ID)
		}

		if err := writeCollections(colFile, col); err != nil {
			return nil, fmt.Errorf("failed to save collections: %w", err)
		}
		return map[string]string{"status": "ok"}, nil
	}
}
func makeCollectionDeleteHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		colFile, err := getCollectionFile(state, payload)
		if err != nil {
			return nil, err
		}
		var req struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}
		if req.ID == "" {
			return nil, fmt.Errorf("id is required")
		}

		col, err := readCollections(colFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read collections: %w", err)
		}

		filtered := make([]CollectionItem, 0, len(col.Items))
		for _, item := range col.Items {
			if item.ID != req.ID {
				filtered = append(filtered, item)
			}
		}
		col.Items = filtered

		if err := writeCollections(colFile, col); err != nil {
			return nil, fmt.Errorf("failed to save collections: %w", err)
		}
		return map[string]string{"status": "ok"}, nil
	}
}
func makeCollectionFolderCreateHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		colFile, err := getCollectionFile(state, payload)
		if err != nil {
			return nil, err
		}
		var req struct {
			Name     string `json:"name"`
			ParentID string `json:"parentId"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}
		if req.Name == "" {
			return nil, fmt.Errorf("name is required")
		}

		col, err := readCollections(colFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read collections: %w", err)
		}

		folder := CollectionFolder{
			ID:        fmt.Sprintf("folder_%d", time.Now().UnixMilli()),
			Name:      req.Name,
			ParentID:  req.ParentID,
			CreatedAt: time.Now().UnixMilli(),
		}
		col.Folders = append(col.Folders, folder)

		if err := writeCollections(colFile, col); err != nil {
			return nil, fmt.Errorf("failed to save collections: %w", err)
		}
		return map[string]any{"folder": folder}, nil
	}
}
func makeCollectionFolderRenameHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		colFile, err := getCollectionFile(state, payload)
		if err != nil {
			return nil, err
		}
		var req struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}
		if req.ID == "" || req.Name == "" {
			return nil, fmt.Errorf("id and name are required")
		}

		col, err := readCollections(colFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read collections: %w", err)
		}

		found := false
		for i, f := range col.Folders {
			if f.ID == req.ID {
				col.Folders[i].Name = req.Name
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("folder not found: %s", req.ID)
		}

		if err := writeCollections(colFile, col); err != nil {
			return nil, fmt.Errorf("failed to save collections: %w", err)
		}
		return map[string]string{"status": "ok"}, nil
	}
}
func makeCollectionFolderDeleteHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		colFile, err := getCollectionFile(state, payload)
		if err != nil {
			return nil, err
		}
		var req struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}
		if req.ID == "" {
			return nil, fmt.Errorf("id is required")
		}

		col, err := readCollections(colFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read collections: %w", err)
		}
		deleteIDs := map[string]bool{req.ID: true}
		changed := true
		for changed {
			changed = false
			for _, f := range col.Folders {
				if deleteIDs[f.ParentID] && !deleteIDs[f.ID] {
					deleteIDs[f.ID] = true
					changed = true
				}
			}
		}
		filteredFolders := make([]CollectionFolder, 0, len(col.Folders))
		for _, f := range col.Folders {
			if !deleteIDs[f.ID] {
				filteredFolders = append(filteredFolders, f)
			}
		}
		filteredItems := make([]CollectionItem, 0, len(col.Items))
		for _, item := range col.Items {
			if !deleteIDs[item.FolderID] {
				filteredItems = append(filteredItems, item)
			}
		}
		col.Folders = filteredFolders
		col.Items = filteredItems

		if err := writeCollections(colFile, col); err != nil {
			return nil, fmt.Errorf("failed to save collections: %w", err)
		}
		return map[string]string{"status": "ok"}, nil
	}
}
func makeCollectionFolderMoveHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		colFile, err := getCollectionFile(state, payload)
		if err != nil {
			return nil, err
		}
		var req struct {
			ID       string `json:"id"`
			ParentID string `json:"parentId"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}
		if req.ID == "" {
			return nil, fmt.Errorf("id is required")
		}

		col, err := readCollections(colFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read collections: %w", err)
		}
		if req.ID == req.ParentID {
			return nil, fmt.Errorf("cannot move folder into itself")
		}
		descendantIDs := map[string]bool{req.ID: true}
		changed := true
		for changed {
			changed = false
			for _, f := range col.Folders {
				if descendantIDs[f.ParentID] && !descendantIDs[f.ID] {
					descendantIDs[f.ID] = true
					changed = true
				}
			}
		}
		if descendantIDs[req.ParentID] {
			return nil, fmt.Errorf("cannot move folder into its descendant")
		}

		found := false
		for i, f := range col.Folders {
			if f.ID == req.ID {
				col.Folders[i].ParentID = req.ParentID
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("folder not found: %s", req.ID)
		}

		if err := writeCollections(colFile, col); err != nil {
			return nil, fmt.Errorf("failed to save collections: %w", err)
		}
		return map[string]string{"status": "ok"}, nil
	}
}
func makeCollectionMoveHandler(state *AppState) HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		colFile, err := getCollectionFile(state, payload)
		if err != nil {
			return nil, err
		}
		var req struct {
			ID       string `json:"id"`
			FolderID string `json:"folderId"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}
		if req.ID == "" {
			return nil, fmt.Errorf("id is required")
		}

		col, err := readCollections(colFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read collections: %w", err)
		}

		found := false
		for i, item := range col.Items {
			if item.ID == req.ID {
				col.Items[i].FolderID = req.FolderID
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("collection not found: %s", req.ID)
		}

		if err := writeCollections(colFile, col); err != nil {
			return nil, fmt.Errorf("failed to save collections: %w", err)
		}
		return map[string]string{"status": "ok"}, nil
	}
}

func makeGameAPIListHandler() HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		_, rawText, parsed, err := callGameAPI("listApi", nil)
		if err != nil {
			return nil, err
		}

		items, err := extractGameAPIItems(parsed)
		if err != nil {
			return nil, fmt.Errorf("unexpected listApi response: %s", rawText)
		}

		return map[string]any{"items": items}, nil
	}
}

func extractGameAPIItems(parsed any) ([]GameAPIInfo, error) {
	if parsed == nil {
		return nil, fmt.Errorf("empty response")
	}

	if items, ok := parsed.([]any); ok {
		return decodeGameAPIItems(items)
	}

	payload, ok := parsed.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("unexpected response type %T", parsed)
	}

	if result, exists := payload["result"]; exists {
		items, ok := result.([]any)
		if !ok {
			return nil, fmt.Errorf("result field is not an array")
		}
		return decodeGameAPIItems(items)
	}

	return nil, fmt.Errorf("missing result field")
}

func decodeGameAPIItems(items []any) ([]GameAPIInfo, error) {
	payloadBytes, err := json.Marshal(items)
	if err != nil {
		return nil, err
	}

	var decoded []GameAPIInfo
	if err := json.Unmarshal(payloadBytes, &decoded); err != nil {
		return nil, err
	}
	return decoded, nil
}
func makeGameAPIExecuteHandler() HandlerFunc {
	return func(payload json.RawMessage) (any, error) {
		var req struct {
			Command string            `json:"command"`
			Params  map[string]string `json:"params"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, fmt.Errorf("invalid payload: %w", err)
		}
		if strings.TrimSpace(req.Command) == "" {
			return nil, fmt.Errorf("command is required")
		}

		statusCode, rawText, parsed, err := callGameAPI(strings.TrimSpace(req.Command), req.Params)
		if err != nil {
			return nil, err
		}

		return gameAPIExecuteResult{
			RawText:    rawText,
			Parsed:     parsed,
			StatusCode: statusCode,
		}, nil
	}
}

func callGameAPI(command string, params map[string]string) (int, string, any, error) {
	cfg, err := loadGameAPIClientConfig()
	if err != nil {
		return 0, "", nil, err
	}

	timestamp := time.Now().Unix()
	query := url.Values{}
	query.Set("_user", cfg.User)
	query.Set("_pass", buildGameAPIPassword(cfg.Password, cfg.AuthKey, timestamp))
	query.Set("_cmd", command)
	query.Set("_timestamp", strconv.FormatInt(timestamp, 10))
	if len(params) > 0 {
		body, err := json.Marshal(params)
		if err != nil {
			return 0, "", nil, fmt.Errorf("marshal game api params: %w", err)
		}
		query.Set("_paramType", "json")
		query.Set("_params", string(body))
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(cfg.URL + "?" + query.Encode())
	if err != nil {
		return 0, "", nil, fmt.Errorf("request game api: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, "", nil, fmt.Errorf("read game api response: %w", err)
	}

	rawText := string(body)
	parsed := parseGameAPIResponseBody(rawText)
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return resp.StatusCode, rawText, parsed, fmt.Errorf("game api request failed (%d): %s", resp.StatusCode, rawText)
	}
	return resp.StatusCode, rawText, parsed, nil
}

func loadGameAPIClientConfig() (*gameAPIClientConfig, error) {
	configPath := os.Getenv("FLOW_PACKET_GAME_API_CONFIG")
	if strings.TrimSpace(configPath) == "" {
		configPath = `C:\game-test\game-p\project\config\api_config.json`
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("read game api config: %w", err)
	}

	var file gameAPIConfigFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, fmt.Errorf("parse game api config: %w", err)
	}

	user := strings.TrimSpace(file.API.Endpoint)
	password := strings.TrimSpace(file.API.Password)
	authKey := strings.TrimSpace(file.API.AuthKey)
	endpointURL := strings.TrimSpace(file.API.URL)
	if endpointURL == "" {
		endpointURL = "http://127.0.0.1:8070/api"
	}
	if user == "" || password == "" || authKey == "" {
		return nil, fmt.Errorf("game api config is incomplete")
	}

	return &gameAPIClientConfig{
		User:     user,
		Password: password,
		AuthKey:  authKey,
		URL:      endpointURL,
	}, nil
}

func buildGameAPIPassword(password string, authKey string, timestamp int64) string {
	sum := md5.Sum([]byte(password + authKey + strconv.FormatInt(timestamp, 10)))
	return hex.EncodeToString(sum[:])
}

func parseGameAPIResponseBody(raw string) any {
	return parseNestedGameAPIResponse(strings.TrimSpace(raw), 0)
}

func parseNestedGameAPIResponse(raw string, depth int) any {
	if raw == "" {
		return ""
	}
	if depth > 3 {
		return raw
	}

	var parsed any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return raw
	}
	if inner, ok := parsed.(string); ok {
		trimmed := strings.TrimSpace(inner)
		if trimmed == "" {
			return ""
		}
		return parseNestedGameAPIResponse(trimmed, depth+1)
	}
	return parsed
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

var missingImportRe = regexp.MustCompile(`could not resolve path "([^"]+)"`)

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

