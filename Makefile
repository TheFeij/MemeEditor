APP_NAME     := MemeEditor
BIN_DIR      := build/bin
LINUX_BIN    := $(BIN_DIR)/$(APP_NAME)
WINDOWS_BIN  := $(BIN_DIR)/$(APP_NAME).exe
FONTS_DIR    := $(BIN_DIR)/fonts
LINUX_TAGS   ?= webkit2_41
WAILS        ?= wails

.PHONY: all build linux windows dev fonts-layout clean

all: build

build: linux windows

# Create the drop-in fonts folder so users know they can add their own fonts.
fonts-layout:
	@mkdir -p $(FONTS_DIR)
	@printf '%s\n' \
		'Place your own font files here (.ttf / .otf / .woff / .woff2).' \
		'They appear in MemeEditor'"'"'s font list the next time you start the app.' \
		> $(FONTS_DIR)/README.txt

linux: fonts-layout
	@mkdir -p $(BIN_DIR)
	@rm -f $(LINUX_BIN)
	$(WAILS) build -platform linux/amd64 -tags $(LINUX_TAGS)
	@echo "Built $(LINUX_BIN)"

windows: fonts-layout
	@mkdir -p $(BIN_DIR)
	@rm -f $(WINDOWS_BIN)
	$(WAILS) build -platform windows/amd64
	@echo "Built $(WINDOWS_BIN)"

dev:
	$(WAILS) dev

clean:
	rm -rf $(BIN_DIR)
