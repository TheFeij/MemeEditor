package main

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	"image/draw"
	_ "image/jpeg"
	"image/png"
	goruntime "runtime"
	"strings"
	"sync"
)

// BlurPNG takes a data-URL encoded image and returns a data-URL encoded PNG
// with a box blur applied. This is the pixel-heavy work that would otherwise
// block the UI thread in JavaScript; running it here keeps the interface
// responsive and lets the blur use every CPU core.
//
// radius is the desired blur spread in pixels. It is approximated (like the
// previous JS implementation) with three box-blur passes of radius/3, which
// gives a smooth, kernel-agnostic blur without a per-pixel loop over radius.
func (a *App) BlurPNG(dataURL string, radius int) (string, error) {
	img, err := decodeDataURL(dataURL)
	if err != nil {
		return "", err
	}
	if radius < 1 {
		radius = 1
	}

	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return "", errors.New("empty image")
	}

	rgba := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(rgba, rgba.Bounds(), img, b.Min, draw.Src)

	passR := radius / 3
	if passR < 1 {
		passR = 1
	}
	for i := 0; i < 3; i++ {
		boxBlurH(rgba, passR)
		boxBlurV(rgba, passR)
	}

	return encodePNGDataURL(rgba)
}

func decodeDataURL(s string) (image.Image, error) {
	comma := strings.IndexByte(s, ',')
	if comma < 0 {
		return nil, errors.New("invalid image data")
	}
	raw, err := base64.StdEncoding.DecodeString(s[comma+1:])
	if err != nil {
		return nil, err
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	return img, nil
}

func encodePNGDataURL(img image.Image) (string, error) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

// parallelFor runs fn(i) for every i in [0, n) across all available cores.
func parallelFor(n int, fn func(int)) {
	if n <= 0 {
		return
	}
	workers := goruntime.NumCPU()
	if workers > n {
		workers = n
	}
	if workers < 1 {
		workers = 1
	}
	jobs := make(chan int)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for idx := range jobs {
				fn(idx)
			}
		}()
	}
	for i := 0; i < n; i++ {
		jobs <- i
	}
	close(jobs)
	wg.Wait()
}

func clamp8(v float64) uint8 {
	if v <= 0 {
		return 0
	}
	if v >= 255 {
		return 255
	}
	return uint8(v + 0.5)
}

// boxBlurH applies a horizontal box blur in place. Rows are independent, so
// each row is processed by a separate worker.
func boxBlurH(img *image.RGBA, r int) {
	w := img.Rect.Dx()
	h := img.Rect.Dy()
	stride := img.Stride
	pix := img.Pix
	win := float64(2*r + 1)

	parallelFor(h, func(y int) {
		base := y * stride
		tmp := make([]float64, w*4)
		var sr, sg, sb, sa int
		for i := -r; i <= r; i++ {
			ii := i
			if ii < 0 {
				ii = 0
			} else if ii >= w {
				ii = w - 1
			}
			o := base + ii*4
			sr += int(pix[o])
			sg += int(pix[o+1])
			sb += int(pix[o+2])
			sa += int(pix[o+3])
		}
		for x := 0; x < w; x++ {
			oi := x * 4
			tmp[oi] = float64(sr) / win
			tmp[oi+1] = float64(sg) / win
			tmp[oi+2] = float64(sb) / win
			tmp[oi+3] = float64(sa) / win

			addI := x + r + 1
			if addI >= w {
				addI = w - 1
			}
			subI := x - r
			if subI < 0 {
				subI = 0
			}
			ao := base + addI*4
			so := base + subI*4
			sr += int(pix[ao]) - int(pix[so])
			sg += int(pix[ao+1]) - int(pix[so+1])
			sb += int(pix[ao+2]) - int(pix[so+2])
			sa += int(pix[ao+3]) - int(pix[so+3])
		}
		for x := 0; x < w; x++ {
			o := base + x*4
			oi := x * 4
			pix[o] = clamp8(tmp[oi])
			pix[o+1] = clamp8(tmp[oi+1])
			pix[o+2] = clamp8(tmp[oi+2])
			pix[o+3] = clamp8(tmp[oi+3])
		}
	})
}

// boxBlurV applies a vertical box blur in place. Columns are independent.
func boxBlurV(img *image.RGBA, r int) {
	w := img.Rect.Dx()
	h := img.Rect.Dy()
	stride := img.Stride
	pix := img.Pix
	win := float64(2*r + 1)

	parallelFor(w, func(x int) {
		base := x * 4
		tmp := make([]float64, h*4)
		var sr, sg, sb, sa int
		for i := -r; i <= r; i++ {
			ii := i
			if ii < 0 {
				ii = 0
			} else if ii >= h {
				ii = h - 1
			}
			o := base + ii*stride
			sr += int(pix[o])
			sg += int(pix[o+1])
			sb += int(pix[o+2])
			sa += int(pix[o+3])
		}
		for y := 0; y < h; y++ {
			oi := y * 4
			tmp[oi] = float64(sr) / win
			tmp[oi+1] = float64(sg) / win
			tmp[oi+2] = float64(sb) / win
			tmp[oi+3] = float64(sa) / win

			addI := y + r + 1
			if addI >= h {
				addI = h - 1
			}
			subI := y - r
			if subI < 0 {
				subI = 0
			}
			ao := base + addI*stride
			so := base + subI*stride
			sr += int(pix[ao]) - int(pix[so])
			sg += int(pix[ao+1]) - int(pix[so+1])
			sb += int(pix[ao+2]) - int(pix[so+2])
			sa += int(pix[ao+3]) - int(pix[so+3])
		}
		for y := 0; y < h; y++ {
			o := base + y*stride
			oi := y * 4
			pix[o] = clamp8(tmp[oi])
			pix[o+1] = clamp8(tmp[oi+1])
			pix[o+2] = clamp8(tmp[oi+2])
			pix[o+3] = clamp8(tmp[oi+3])
		}
	})
}
