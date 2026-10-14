package main

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Video memes are exported in a single ffmpeg pass: the original clip is
// decoded and encoded once while every overlay (text, shape, sticker, brush
// stroke) is supplied as a full-size PNG with a time window, added with
// `overlay ... enable='between(t,start,end)'`. This is dramatically faster and
// more reliable than capturing one frame at a time from the webview.
//
// "Background blur" objects cannot be baked into a static PNG (they blur the
// moving frame beneath them), so they are exported as a black/white mask: the
// frame is box-blurred and composited back through the mask.

type VideoExportLayer struct {
	Image string  `json:"image"` // full-canvas PNG data URL (overlay) or mask
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Blur  int     `json:"blur"` // > 0 => background-blur mask, value is radius
}

type VideoExportOptions struct {
	SourcePath string             `json:"sourcePath"` // preferred: original file
	SourceData string             `json:"sourceData"` // fallback: data URL
	Width      int                `json:"width"`
	Height     int                `json:"height"`
	PadLeft    int                `json:"padLeft"`
	PadTop     int                `json:"padTop"`
	Background string             `json:"background"`
	FPS        int                `json:"fps"`
	Duration   float64            `json:"duration"`
	Filename   string             `json:"filename"`
	Layers     []VideoExportLayer `json:"layers"`
}

// ReadMediaFile reads an image or video from disk and returns it as a data
// URL. Used for files dropped onto the window through the native drag-and-drop
// bridge, where the browser gives us a path rather than a File object.
func (a *App) ReadMediaFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	mimeType := mime.TypeByExtension(strings.ToLower(filepath.Ext(path)))
	if !isMediaMime(mimeType) {
		mimeType = http.DetectContentType(data)
	}
	if !isMediaMime(mimeType) {
		return "", errors.New("unsupported media type")
	}
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func isMediaMime(m string) bool {
	return strings.HasPrefix(m, "image/") || strings.HasPrefix(m, "video/")
}

// FFmpegAvailable reports whether ffmpeg can be found on the PATH.
func (a *App) FFmpegAvailable() bool {
	_, err := exec.LookPath("ffmpeg")
	return err == nil
}

// PickVideoFile opens a native file dialog and returns the chosen path. Having
// the real path lets the exporter read the clip directly instead of shuffling
// the whole file through the webview as base64.
func (a *App) PickVideoFile() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open Video",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "Video (*.mp4;*.webm;*.mov;*.mkv;*.avi;*.m4v;*.ogv)",
				Pattern:     "*.mp4;*.webm;*.mov;*.mkv;*.avi;*.m4v;*.ogv",
			},
		},
	})
}

// ExportVideo renders the composition to a video file and returns the saved
// path ("" when the user cancels the save dialog).
func (a *App) ExportVideo(opts VideoExportOptions) (string, error) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		return "", errors.New("ffmpeg was not found on PATH")
	}
	if opts.Width < 1 || opts.Height < 1 {
		return "", errors.New("invalid output size")
	}

	fps := opts.FPS
	if fps <= 0 {
		fps = 30
	}
	name := opts.Filename
	if name == "" {
		name = "meme.mp4"
	}

	dialog := runtime.SaveDialogOptions{
		Title:           "Save Video",
		DefaultFilename: name,
		Filters: []runtime.FileFilter{
			{DisplayName: "MP4 Video (*.mp4)", Pattern: "*.mp4"},
			{DisplayName: "WebM Video (*.webm)", Pattern: "*.webm"},
		},
	}
	if dir := a.lastSaveDir(); dir != "" {
		dialog.DefaultDirectory = dir
	}
	outPath, err := runtime.SaveFileDialog(a.ctx, dialog)
	if err != nil {
		return "", err
	}
	if outPath == "" {
		return "", nil
	}
	lower := strings.ToLower(outPath)
	if !strings.HasSuffix(lower, ".mp4") && !strings.HasSuffix(lower, ".webm") {
		outPath += ".mp4"
		lower = strings.ToLower(outPath)
	}

	tmpDir, err := os.MkdirTemp("", "meme-video-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmpDir)

	// Resolve the source clip to a file on disk.
	srcPath := opts.SourcePath
	if srcPath == "" || !fileExists(srcPath) {
		if !strings.HasPrefix(opts.SourceData, "data:") {
			return "", errors.New("no source video")
		}
		data, ext, derr := decodeDataURLBytes(opts.SourceData)
		if derr != nil {
			return "", derr
		}
		if ext == ".bin" {
			ext = ".mp4"
		}
		srcPath = filepath.Join(tmpDir, "source"+ext)
		if werr := os.WriteFile(srcPath, data, 0o644); werr != nil {
			return "", werr
		}
	}

	// Write each overlay/mask PNG.
	layerPaths := make([]string, len(opts.Layers))
	for i, layer := range opts.Layers {
		if !strings.HasPrefix(layer.Image, "data:") {
			return "", errors.New("invalid layer image")
		}
		data, _, derr := decodeDataURLBytes(layer.Image)
		if derr != nil {
			return "", derr
		}
		p := filepath.Join(tmpDir, fmt.Sprintf("layer-%04d.png", i))
		if werr := os.WriteFile(p, data, 0o644); werr != nil {
			return "", werr
		}
		layerPaths[i] = p
	}

	color := "black"
	if c, ok := normalizeFFColor(opts.Background); ok {
		color = c
	}

	filter := buildFilter(opts.Width, opts.Height, opts.PadLeft, opts.PadTop, color, opts.Layers)

	encoder := "libx264"
	if !ffmpegHasEncoder(ffmpeg, "libx264") {
		encoder = "mpeg4"
	}

	args := []string{"-y", "-hide_banner", "-loglevel", "error", "-i", srcPath}
	for _, p := range layerPaths {
		args = append(args, "-loop", "1", "-framerate", strconv.Itoa(fps), "-i", p)
	}
	args = append(args, "-filter_complex", filter, "-map", "[vout]", "-map", "0:a:0?")
	if encoder == "libx264" {
		args = append(args, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20")
	} else {
		args = append(args, "-c:v", "mpeg4", "-q:v", "3")
	}
	args = append(args, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k")
	if opts.Duration > 0 {
		args = append(args, "-t", strconv.FormatFloat(opts.Duration, 'f', 3, 64))
	}
	if strings.HasSuffix(lower, ".mp4") {
		args = append(args, "-movflags", "+faststart")
	}
	args = append(args, outPath)

	cmd := exec.Command(ffmpeg, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if len(msg) > 800 {
			msg = msg[len(msg)-800:]
		}
		if msg == "" {
			msg = err.Error()
		}
		cleanupPath(outPath)
		return "", errors.New(msg)
	}

	a.rememberSaveDir(filepath.Dir(outPath))
	return outPath, nil
}

// buildFilter composes the pad + overlay + blur graph. Overlay inputs start at
// index 1 (index 0 is the source video).
func buildFilter(width, height, padX, padY int, color string, layers []VideoExportLayer) string {
	if padX < 0 {
		padX = 0
	}
	if padY < 0 {
		padY = 0
	}
	parts := []string{
		fmt.Sprintf("[0:v]pad=%d:%d:%d:%d:color=%s[base]", width, height, padX, padY, color),
	}
	prev := "base"
	for i, layer := range layers {
		idx := i + 1
		label := fmt.Sprintf("v%d", idx)
		start := layer.Start
		end := layer.End
		if end <= start {
			end = start + 0.001
		}
		if layer.Blur > 0 {
			r := layer.Blur
			maxR := (minInt(width, height) - 1) / 2
			if maxR < 1 {
				maxR = 1
			}
			if r > maxR {
				r = maxR
			}
			a := label + "a"
			b := label + "b"
			bl := label + "bl"
			m := label + "m"
			parts = append(parts,
				fmt.Sprintf("[%s]split[%s][%s]", prev, a, b),
				fmt.Sprintf("[%s]boxblur=luma_radius=%d:luma_power=2:chroma_radius=%d:chroma_power=2[%s]", b, r, r, bl),
				fmt.Sprintf("[%s][%d:v]alphamerge[%s]", bl, idx, m),
				fmt.Sprintf("[%s][%s]overlay=0:0:enable='between(t,%.3f,%.3f)'[%s]", a, m, start, end, label),
			)
		} else {
			parts = append(parts,
				fmt.Sprintf("[%s][%d:v]overlay=0:0:enable='between(t,%.3f,%.3f)'[%s]", prev, idx, start, end, label),
			)
		}
		prev = label
	}
	parts = append(parts, fmt.Sprintf("[%s]crop=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[vout]", prev))
	return strings.Join(parts, ";")
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func normalizeFFColor(c string) (string, bool) {
	c = strings.TrimSpace(c)
	if len(c) == 7 && c[0] == '#' {
		return "0x" + c[1:], true
	}
	if len(c) == 8 && strings.HasPrefix(c, "0x") {
		return c, true
	}
	return "", false
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func ffmpegHasEncoder(ffmpeg, name string) bool {
	out, err := exec.Command(ffmpeg, "-hide_banner", "-encoders").CombinedOutput()
	if err != nil {
		return false
	}
	return strings.Contains(string(out), name)
}

func decodeDataURLBytes(s string) ([]byte, string, error) {
	comma := strings.IndexByte(s, ',')
	if comma < 0 {
		return nil, "", errors.New("invalid data URL")
	}
	header := s[:comma]
	raw, err := base64.StdEncoding.DecodeString(s[comma+1:])
	if err != nil {
		return nil, "", err
	}
	ext := ".bin"
	switch {
	case strings.Contains(header, "video/mp4"):
		ext = ".mp4"
	case strings.Contains(header, "video/webm"):
		ext = ".webm"
	case strings.Contains(header, "video/quicktime"):
		ext = ".mov"
	case strings.Contains(header, "video/x-matroska"):
		ext = ".mkv"
	case strings.Contains(header, "video/x-msvideo"):
		ext = ".avi"
	}
	return raw, ext, nil
}

func cleanupPath(path string) {
	if path != "" {
		_ = os.Remove(path)
	}
}
