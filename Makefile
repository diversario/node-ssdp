REPORTER = spec

test:
	./node_modules/.bin/mocha --recursive --reporter $(REPORTER) --exit

coverage:
	@npm run coverage

coveralls: coverage
	@cat coverage/lcov.info | ./node_modules/.bin/coveralls
	@$(MAKE) clean

clean:
	@rm -rf coverage

.PHONY: test coverage coveralls clean
