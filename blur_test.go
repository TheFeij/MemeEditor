package main

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestBlurPNGSmoothsEdge(t *testing.T) {
	const w, h = 64, 4
	src := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if x < w/2 {
				src.Set(x, y, color.RGBA{0, 0, 0, 255})
			} else {
				src.Set(x, y, color.RGBA{255, 255, 255, 255})
			}
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, src); err != nil {
		t.Fatal(err)
	}
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())

	out, err := NewApp().BlurPNG(dataURL, 12)
	if err != nil {
		t.Fatal(err)
	}
	img, err := decodeDataURL(out)
	if err != nil {
		t.Fatal(err)
	}
	// The boundary pixel should move toward mid-grey after blurring.
	r, _, _, _ := img.At(w/2-1, 0).RGBA()
	edge := int(r >> 8)
	if edge <= 5 || edge >= 250 {
		t.Fatalf("edge pixel was not blurred, got %d", edge)
	}
	// Far from the edge the values should stay near black/white.
	left, _, _, _ := img.At(0, 0).RGBA()
	if int(left>>8) > 40 {
		t.Fatalf("far-left pixel unexpectedly blurred: %d", left>>8)
	}
}
