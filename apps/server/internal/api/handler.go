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
	"github.com/flow-packet/server/internal/thriftparser"
)

type ConnState struct {
	ProtoDir       string
	CollectionFile string
	RouteFile      string
	ParseResult    *parser.ParseResult
	ThriftResult   *thriftparser.ParseResult
	RouteMappings  map[string]RouteMapping
}
type AppState struct {
	DataDir                 string
	TemplateFile            string
	CollectionFile          string
	CollectionMigrationFile string
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
	protoDir := filepath.Join(connDir, "proto")
	os.MkdirAll(protoDir, 0755)

	routeFile := filepath.Join(connDir, "routes.json")
	cs = &ConnState{
		ProtoDir:       protoDir,
		CollectionFile: filepath.Join(connDir, "collections.json"),
		RouteFile:      routeFile,
		RouteMappings:  make(map[string]RouteMapping),
	}
	if routes, err := readRouteMappings(routeFile); err == nil {
		for _, rm := range routes {
			cs.RouteMappings[rm.Key()] = rm
		}
	}

	if protoResult, thriftResult, err := loadSchemaDir(protoDir); err == nil {
		cs.ParseResult = protoResult
		cs.ThriftResult = thriftResult
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

func (rm RouteMapping) Key() string {
	if rm.StringRoute != "" {
		return rm.StringRoute
	}
	return fmt.Sprintf("%d", rm.Route)
}
func NewAppState(dataDir string) *AppState {
	return &AppState{
		DataDir:                 dataDir,
		TemplateFile:            filepath.Join(dataDir, "templates.json"),
		CollectionFile:          filepath.Join(dataDir, "collections.json"),
		CollectionMigrationFile: filepath.Join(dataDir, "collections.migrated"),
		connections:             make(map[string]*ConnState),
	}
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
	srv.Handle("collection.save", makeCollectionSaveHandler(state))
	srv.Handle("collection.update", makeCollectionUpdateHandler(state))
	srv.Handle("collection.rename", makeCollectionRenameHandler(state))
	srv.Handle("collection.delete", makeCollectionDeleteHandler(state))
	srv.Handle("collection.folder.create", makeCollectionFolderCreateHandler(state))
	srv.Handle("collection.folder.rename", makeCollectionFolderRenameHandler(state))
	srv.Handle("collection.folder.delete", makeCollectionFolderDeleteHandler(state))
	srv.Handle("collection.folder.move", makeCollectionFolderMoveHandler(state))
	srv.Handle("collection.move", makeCollectionMoveHandler(state))
}
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

		paths := r.MultipartForm.Value["paths"]

		os.RemoveAll(cs.ProtoDir)
		os.MkdirAll(cs.ProtoDir, 0755)

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

			dstPath := filepath.Join(cs.ProtoDir, cleanName)
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

		protoResult, thriftResult, err := loadSchemaDir(cs.ProtoDir)
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

		cs.ParseResult = protoResult
		cs.ThriftResult = thriftResult

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
		if cs == nil {
			return map[string]any{
				"files":    []any{},
				"messages": []any{},
			}, nil
		}
		if cs.ParseResult != nil {
			return map[string]any{
				"files":    cs.ParseResult.Files,
				"messages": cs.ParseResult.AllMessages(),
			}, nil
		}
		if cs.ThriftResult != nil {
			return map[string]any{
				"files":    cs.ThriftResult.Files,
				"messages": cs.ThriftResult.AllMessages(),
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
		return col, nil
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
