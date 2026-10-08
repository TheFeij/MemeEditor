package main

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func withTempConfig(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	configPathOverride = filepath.Join(dir, "MemeEditor.config.json")
	t.Cleanup(func() { configPathOverride = "" })
}

func TestPreferencesRoundTrip(t *testing.T) {
	withTempConfig(t)
	a := NewApp()

	got, err := a.LoadPreferences()
	if err != nil {
		t.Fatalf("LoadPreferences on empty config: %v", err)
	}
	if got != "{}" {
		t.Fatalf("expected empty preferences object, got %q", got)
	}

	prefs := `{"background":"#ffffff","textPresets":[{"id":"1","name":"x"}]}`
	if err := a.SavePreferences(prefs); err != nil {
		t.Fatalf("SavePreferences: %v", err)
	}

	got, err = a.LoadPreferences()
	if err != nil {
		t.Fatalf("LoadPreferences: %v", err)
	}
	if !json.Valid([]byte(got)) {
		t.Fatalf("stored preferences are not valid JSON: %q", got)
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("unmarshal preferences: %v", err)
	}
	if parsed["background"] != "#ffffff" {
		t.Fatalf("background not persisted, got %v", parsed["background"])
	}
}

func TestSavePreferencesRejectsInvalidJSON(t *testing.T) {
	withTempConfig(t)
	a := NewApp()
	if err := a.SavePreferences("not json"); err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestSaveDirAndPreferencesCoexist(t *testing.T) {
	withTempConfig(t)
	a := NewApp()

	if err := a.SavePreferences(`{"background":"#000000"}`); err != nil {
		t.Fatalf("SavePreferences: %v", err)
	}
	a.rememberSaveDir("/tmp/some/dir")

	if got := a.lastSaveDir(); got != "/tmp/some/dir" {
		t.Fatalf("lastSaveDir = %q, want /tmp/some/dir", got)
	}

	got, err := a.LoadPreferences()
	if err != nil {
		t.Fatalf("LoadPreferences: %v", err)
	}
	var parsed map[string]any
	_ = json.Unmarshal([]byte(got), &parsed)
	if parsed["background"] != "#000000" {
		t.Fatalf("preferences clobbered by rememberSaveDir: %v", parsed)
	}
}
