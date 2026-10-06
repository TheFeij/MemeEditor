APP_NAME     := MemeEditor
BIN_DIR      := build/bin
LINUX_BIN    := $(BIN_DIR)/$(APP_NAME)
WINDOWS_BIN  := $(BIN_DIR)/$(APP_NAME).exe
LINUX_TAGS   ?= webkit2_41
WAILS        ?= wails

.PHONY: all build linux windows dev clean

all: build

build: linux windows

linux:
	@mkdir -p $(BIN_DIR)
	@rm -f $(LINUX_BIN)
	$(WAILS) build -platform linux/amd64 -tags $(LINUX_TAGS)
	@echo "Built $(LINUX_BIN)"

windows:
	@mkdir -p $(BIN_DIR)
	@rm -f $(WINDOWS_BIN)
	$(WAILS) build -platform windows/amd64
	@echo "Built $(WINDOWS_BIN)"

dev:
	$(WAILS) dev

clean:
	rm -rf $(BIN_DIR)
