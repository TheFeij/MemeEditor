package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
)

// UserFont is a font discovered in a drop-in "fonts" folder at runtime.
type UserFont struct {
	Family  string `json:"family"`
	Name    string `json:"name"`
	DataURL string `json:"dataUrl"`
}

func fontExtOK(ext string) bool {
	switch strings.ToLower(ext) {
	case ".ttf", ".otf", ".woff", ".woff2", ".eot":
		return true
	}
	return false
}

func fontMime(ext string) string {
	switch strings.ToLower(ext) {
	case ".ttf":
		return "font/ttf"
	case ".otf":
		return "font/otf"
	case ".woff":
		return "font/woff"
	case ".woff2":
		return "font/woff2"
	case ".eot":
		return "application/vnd.ms-fontobject"
	}
	return "application/octet-stream"
}

func deriveFontFamily(name string) string {
	base := strings.TrimSuffix(name, filepath.Ext(name))
	base = strings.NewReplacer("-", " ", "_", " ").Replace(base)
	return strings.Join(strings.Fields(base), " ")
}

// userFontDirs lists the folders scanned for user-provided fonts, in priority
// order: a "fonts" folder next to the executable, then one in the working
// directory (handy during development).
func userFontDirs() []string {
	seen := map[string]bool{}
	var dirs []string
	add := func(p string) {
		if p == "" || seen[p] {
			return
		}
		seen[p] = true
		dirs = append(dirs, p)
	}
	if exe, err := os.Executable(); err == nil {
		add(filepath.Join(filepath.Dir(exe), "fonts"))
	}
	if cwd, err := os.Getwd(); err == nil {
		add(filepath.Join(cwd, "fonts"))
	}
	return dirs
}

// ListUserFonts returns every font file found in the drop-in folders as a data
// URL, so the frontend can register it with the FontFace API at runtime.
func (a *App) ListUserFonts() []UserFont {
	var out []UserFont
	seen := map[string]bool{}
	for _, dir := range userFontDirs() {
		out = append(out, listFontsInDir(dir, seen)...)
	}
	return out
}

func listFontsInDir(dir string, seen map[string]bool) []UserFont {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []UserFont
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		ext := filepath.Ext(name)
		if !fontExtOK(ext) {
			continue
		}
		family := deriveFontFamily(name)
		if family == "" {
			continue
		}
		key := strings.ToLower(family)
		if seen[key] {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			continue
		}
		seen[key] = true
		out = append(out, UserFont{
			Family:  family,
			Name:    name,
			DataURL: "data:" + fontMime(ext) + ";base64," + base64.StdEncoding.EncodeToString(data),
		})
	}
	return out
}
