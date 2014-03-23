REPORTER = spec

all: install build

install:
	@npm install

build:
	@./node_modules/.bin/component build --standalone idgen
	@mv build/build.js idgen.js
	@rm -rf build

test:
	@NODE_ENV=test ./node_modules/.bin/mocha \
		--reporter $(REPORTER)

.PHONY: test
