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

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx context.Context
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

type appConfig struct {
	LastSaveDir string `json:"lastSaveDir"`
}

func configFile() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "MemeEditor", "config.json")
}

func (a *App) lastSaveDir() string {
	path := configFile()
	if path == "" {
		return ""
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var cfg appConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return ""
	}
	return cfg.LastSaveDir
}

func (a *App) rememberSaveDir(dir string) {
	path := configFile()
	if path == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	data, err := json.MarshalIndent(appConfig{LastSaveDir: dir}, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(path, data, 0o644)
}
