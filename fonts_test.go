package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestListFontsInDir(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "MyriadArabic-Regular.otf"), []byte("OTTOfake"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("ignore me"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}

	fonts := listFontsInDir(dir, map[string]bool{})
	if len(fonts) != 1 {
		t.Fatalf("expected 1 font, got %d", len(fonts))
	}
	f := fonts[0]
	if f.Family != "MyriadArabic Regular" {
		t.Errorf("family = %q, want %q", f.Family, "MyriadArabic Regular")
	}
	if !strings.HasPrefix(f.DataURL, "data:font/otf;base64,") {
		t.Errorf("unexpected data URL prefix: %q", f.DataURL[:20])
	}
}

func TestListFontsInDirDedupes(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "Cool-Font.ttf"), []byte("a"), 0o644)
	os.WriteFile(filepath.Join(dir, "Cool_Font.woff2"), []byte("b"), 0o644)
	seen := map[string]bool{}
	fonts := listFontsInDir(dir, seen)
	if len(fonts) != 1 {
		t.Fatalf("expected 1 deduped font, got %d", len(fonts))
	}
}
