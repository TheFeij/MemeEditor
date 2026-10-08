package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx context.Context
	mu  sync.Mutex
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) ReadImageFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	mimeType := mime.TypeByExtension(strings.ToLower(filepath.Ext(path)))
	if !strings.HasPrefix(mimeType, "image/") {
		mimeType = http.DetectContentType(data)
	}
	if !strings.HasPrefix(mimeType, "image/") {
		return "", errors.New("unsupported image type")
	}
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func (a *App) SaveImage(dataURL string) (string, error) {
	comma := strings.IndexByte(dataURL, ',')
	if comma < 0 {
		return "", errors.New("invalid image data")
	}
	data, err := base64.StdEncoding.DecodeString(dataURL[comma+1:])
	if err != nil {
		return "", err
	}

	options := runtime.SaveDialogOptions{
		Title:           "Save Image",
		DefaultFilename: "meme.png",
		Filters: []runtime.FileFilter{
			{DisplayName: "PNG Image (*.png)", Pattern: "*.png"},
		},
	}
	if dir := a.lastSaveDir(); dir != "" {
		options.DefaultDirectory = dir
	}

	path, err := runtime.SaveFileDialog(a.ctx, options)
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	if !strings.HasSuffix(strings.ToLower(path), ".png") {
		path += ".png"
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", err
	}
	a.rememberSaveDir(filepath.Dir(path))
	return path, nil
}

// ---------------------------------------------------------------------
// Configuration file
// ---------------------------------------------------------------------
//
// Preferences are stored in a small JSON file next to the application
// executable so user choices (text presets, colours, brush settings, logo and
// so on) survive across launches. The file lives beside the binary rather than
// in a per-OS config directory because the app is meant to be portable: copy
// the folder and keep your settings. When that location is not writable (for
// example a read-only install or a macOS bundle) we fall back to the working
// directory and finally to the per-user config directory.

const configFileName = "MemeEditor.config.json"

type appConfig struct {
	LastSaveDir string          `json:"lastSaveDir,omitempty"`
	Preferences json.RawMessage `json:"preferences,omitempty"`
}

func configCandidates() []string {
	var out []string
	if exe, err := os.Executable(); err == nil {
		out = append(out, filepath.Join(filepath.Dir(exe), configFileName))
	}
	if cwd, err := os.Getwd(); err == nil {
		out = append(out, filepath.Join(cwd, configFileName))
	}
	if dir, err := os.UserConfigDir(); err == nil {
		out = append(out, filepath.Join(dir, "MemeEditor", "config.json"))
	}
	return out
}

func dirWritable(dir string) bool {
	f, err := os.CreateTemp(dir, ".memeeditor-write-test-*")
	if err != nil {
		return false
	}
	name := f.Name()
	_ = f.Close()
	_ = os.Remove(name)
	return true
}

// configPathOverride forces a specific config location (used by tests).
var configPathOverride string

// configFile returns the first candidate location that can be created and
// written to, or an empty string when none is available.
func configFile() string {
	if configPathOverride != "" {
		return configPathOverride
	}
	for _, path := range configCandidates() {
		dir := filepath.Dir(path)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			continue
		}
		if dirWritable(dir) {
			return path
		}
	}
	return ""
}

// ConfigPath exposes the resolved configuration file location to the
// frontend (useful for diagnostics / showing the user where settings live).
func (a *App) ConfigPath() string {
	return configFile()
}

func (a *App) readConfigLocked() appConfig {
	path := configFile()
	if path == "" {
		return appConfig{}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return appConfig{}
	}
	var cfg appConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return appConfig{}
	}
	return cfg
}

func (a *App) writeConfigLocked(cfg appConfig) error {
	path := configFile()
	if path == "" {
		return errors.New("no writable config location")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// LoadPreferences returns the stored preferences object as raw JSON.
func (a *App) LoadPreferences() (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	cfg := a.readConfigLocked()
	if len(cfg.Preferences) == 0 {
		return "{}", nil
	}
	return string(cfg.Preferences), nil
}

// SavePreferences replaces the stored preferences object with the supplied
// JSON, preserving other fields (such as the last save directory).
func (a *App) SavePreferences(preferences string) error {
	if !json.Valid([]byte(preferences)) {
		return errors.New("invalid preferences JSON")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	cfg := a.readConfigLocked()
	cfg.Preferences = json.RawMessage(preferences)
	return a.writeConfigLocked(cfg)
}

func (a *App) lastSaveDir() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.readConfigLocked().LastSaveDir
}

func (a *App) rememberSaveDir(dir string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	cfg := a.readConfigLocked()
	cfg.LastSaveDir = dir
	_ = a.writeConfigLocked(cfg)
}
