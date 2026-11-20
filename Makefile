REPORTER = spec

test:
	./node_modules/.bin/mocha --recursive --reporter $(REPORTER) --exit test/lib

test-network:
	@sh test/network/run.sh

coverage:
	@npm run coverage

clean:
	@rm -rf coverage

.PHONY: test test-network coverage clean
