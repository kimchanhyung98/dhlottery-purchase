'use strict';

var index = require('./index.js');
var require$$2 = require('crypto');
require('os');
require('fs');
require('path');
require('http');
require('https');
require('net');
require('tls');
require('events');
require('assert');
require('util');
require('stream');
require('buffer');
require('querystring');
require('stream/web');
require('node:stream');
require('node:util');
require('node:events');
require('worker_threads');
require('perf_hooks');
require('util/types');
require('async_hooks');
require('console');
require('url');
require('zlib');
require('string_decoder');
require('diagnostics_channel');
require('fs/promises');
require('child_process');
require('readline');
require('tty');
require('constants');
require('dns');
require('process');
require('module');
require('inspector');

/**
 * Copyright 2023 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @internal
 */
class UnserializableError extends Error {
}
/**
 * @internal
 */
class BidiSerializer {
    static serializeNumber(arg) {
        let value;
        if (Object.is(arg, -0)) {
            value = '-0';
        }
        else if (Object.is(arg, Infinity)) {
            value = 'Infinity';
        }
        else if (Object.is(arg, -Infinity)) {
            value = '-Infinity';
        }
        else if (Object.is(arg, NaN)) {
            value = 'NaN';
        }
        else {
            value = arg;
        }
        return {
            type: 'number',
            value,
        };
    }
    static serializeObject(arg) {
        if (arg === null) {
            return {
                type: 'null',
            };
        }
        else if (Array.isArray(arg)) {
            const parsedArray = arg.map(subArg => {
                return BidiSerializer.serializeRemoveValue(subArg);
            });
            return {
                type: 'array',
                value: parsedArray,
            };
        }
        else if (index.isPlainObject(arg)) {
            try {
                JSON.stringify(arg);
            }
            catch (error) {
                if (error instanceof TypeError &&
                    error.message.startsWith('Converting circular structure to JSON')) {
                    error.message += ' Recursive objects are not allowed.';
                }
                throw error;
            }
            const parsedObject = [];
            for (const key in arg) {
                parsedObject.push([
                    BidiSerializer.serializeRemoveValue(key),
                    BidiSerializer.serializeRemoveValue(arg[key]),
                ]);
            }
            return {
                type: 'object',
                value: parsedObject,
            };
        }
        else if (index.isRegExp(arg)) {
            return {
                type: 'regexp',
                value: {
                    pattern: arg.source,
                    flags: arg.flags,
                },
            };
        }
        else if (index.isDate(arg)) {
            return {
                type: 'date',
                value: arg.toISOString(),
            };
        }
        throw new UnserializableError('Custom object sterilization not possible. Use plain objects instead.');
    }
    static serializeRemoveValue(arg) {
        switch (typeof arg) {
            case 'symbol':
            case 'function':
                throw new UnserializableError(`Unable to serializable ${typeof arg}`);
            case 'object':
                return BidiSerializer.serializeObject(arg);
            case 'undefined':
                return {
                    type: 'undefined',
                };
            case 'number':
                return BidiSerializer.serializeNumber(arg);
            case 'bigint':
                return {
                    type: 'bigint',
                    value: arg.toString(),
                };
            case 'string':
                return {
                    type: 'string',
                    value: arg,
                };
            case 'boolean':
                return {
                    type: 'boolean',
                    value: arg,
                };
        }
    }
    static async serialize(arg, context) {
        if (arg instanceof index.LazyArg) {
            arg = await arg.get(context);
        }
        const objectHandle = arg && (arg instanceof JSHandle || arg instanceof ElementHandle)
            ? arg
            : null;
        if (objectHandle) {
            if (objectHandle.context() !== context &&
                !('sharedId' in objectHandle.remoteValue())) {
                throw new Error('JSHandles can be evaluated only in the context they were created!');
            }
            if (objectHandle.disposed) {
                throw new Error('JSHandle is disposed!');
            }
            return objectHandle.remoteValue();
        }
        return BidiSerializer.serializeRemoveValue(arg);
    }
    static deserializeNumber(value) {
        switch (value) {
            case '-0':
                return -0;
            case 'NaN':
                return NaN;
            case 'Infinity':
                return Infinity;
            case '-Infinity':
                return -Infinity;
            default:
                return value;
        }
    }
    static deserializeLocalValue(result) {
        switch (result.type) {
            case 'array':
                // TODO: Check expected output when value is undefined
                return result.value?.map(value => {
                    return BidiSerializer.deserializeLocalValue(value);
                });
            case 'set':
                // TODO: Check expected output when value is undefined
                return result.value.reduce((acc, value) => {
                    return acc.add(BidiSerializer.deserializeLocalValue(value));
                }, new Set());
            case 'object':
                if (result.value) {
                    return result.value.reduce((acc, tuple) => {
                        const { key, value } = BidiSerializer.deserializeTuple(tuple);
                        acc[key] = value;
                        return acc;
                    }, {});
                }
                break;
            case 'map':
                return result.value.reduce((acc, tuple) => {
                    const { key, value } = BidiSerializer.deserializeTuple(tuple);
                    return acc.set(key, value);
                }, new Map());
            case 'promise':
                return {};
            case 'regexp':
                return new RegExp(result.value.pattern, result.value.flags);
            case 'date':
                return new Date(result.value);
            case 'undefined':
                return undefined;
            case 'null':
                return null;
            case 'number':
                return BidiSerializer.deserializeNumber(result.value);
            case 'bigint':
                return BigInt(result.value);
            case 'boolean':
                return Boolean(result.value);
            case 'string':
                return result.value;
        }
        throw new UnserializableError(`Deserialization of type ${result.type} not supported.`);
    }
    static deserializeTuple([serializedKey, serializedValue]) {
        const key = typeof serializedKey === 'string'
            ? serializedKey
            : BidiSerializer.deserializeLocalValue(serializedKey);
        const value = BidiSerializer.deserializeLocalValue(serializedValue);
        return { key, value };
    }
    static deserialize(result) {
        if (!result) {
            index.debugError('Service did not produce a result.');
            return undefined;
        }
        try {
            return BidiSerializer.deserializeLocalValue(result);
        }
        catch (error) {
            if (error instanceof UnserializableError) {
                index.debugError(error.message);
                return undefined;
            }
            throw error;
        }
    }
}

/**
 * Copyright 2023 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @internal
 */
const debugError = index.debug('puppeteer:error');
/**
 * @internal
 */
async function releaseReference(client, remoteReference) {
    if (!remoteReference.handle) {
        return;
    }
    await client.connection
        .send('script.disown', {
        target: client.target,
        handles: [remoteReference.handle],
    })
        .catch((error) => {
        // Exceptions might happen in case of a page been navigated or closed.
        // Swallow these since they are harmless and we don't leak anything in this case.
        debugError(error);
    });
}
/**
 * @internal
 */
function createEvaluationError(details) {
    if (details.exception.type !== 'error') {
        return BidiSerializer.deserialize(details.exception);
    }
    const [name = '', ...parts] = details.text.split(': ');
    const message = parts.join(': ');
    const error = new Error(message);
    error.name = name;
    // The first line is this function which we ignore.
    const stackLines = [];
    if (details.stackTrace && stackLines.length < Error.stackTraceLimit) {
        for (const frame of details.stackTrace.callFrames.reverse()) {
            if (index.PuppeteerURL.isPuppeteerURL(frame.url) &&
                frame.url !== index.PuppeteerURL.INTERNAL_URL) {
                const url = index.PuppeteerURL.parse(frame.url);
                stackLines.unshift(`    at ${frame.functionName || url.functionName} (${url.functionName} at ${url.siteString}, <anonymous>:${frame.lineNumber}:${frame.columnNumber})`);
            }
            else {
                stackLines.push(`    at ${frame.functionName || '<anonymous>'} (${frame.url}:${frame.lineNumber}:${frame.columnNumber})`);
            }
            if (stackLines.length >= Error.stackTraceLimit) {
                break;
            }
        }
    }
    error.stack = [details.text, ...stackLines].join('\n');
    return error;
}

/**
 * Copyright 2023 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
class JSHandle extends index.JSHandle {
    #disposed = false;
    #realm;
    #remoteValue;
    constructor(realm, remoteValue) {
        super();
        this.#realm = realm;
        this.#remoteValue = remoteValue;
    }
    context() {
        return this.#realm;
    }
    get disposed() {
        return this.#disposed;
    }
    async evaluate(pageFunction, ...args) {
        pageFunction = index.withSourcePuppeteerURLIfNone(this.evaluate.name, pageFunction);
        return await this.context().evaluate(pageFunction, this, ...args);
    }
    async evaluateHandle(pageFunction, ...args) {
        pageFunction = index.withSourcePuppeteerURLIfNone(this.evaluateHandle.name, pageFunction);
        return this.context().evaluateHandle(pageFunction, this, ...args);
    }
    async getProperty(propertyName) {
        return await this.evaluateHandle((object, propertyName) => {
            return object[propertyName];
        }, propertyName);
    }
    async getProperties() {
        // TODO(lightning00blade): Either include return of depth Handles in RemoteValue
        // or new BiDi command that returns array of remote value
        const keys = await this.evaluate(object => {
            const enumerableKeys = [];
            const descriptors = Object.getOwnPropertyDescriptors(object);
            for (const key in descriptors) {
                if (descriptors[key]?.enumerable) {
                    enumerableKeys.push(key);
                }
            }
            return enumerableKeys;
        });
        const map = new Map();
        const results = await Promise.all(keys.map(key => {
            return this.getProperty(key);
        }));
        for (const [key, value] of Object.entries(keys)) {
            const handle = results[key];
            if (handle) {
                map.set(value, handle);
            }
        }
        return map;
    }
    async jsonValue() {
        const value = BidiSerializer.deserialize(this.#remoteValue);
        if (this.#remoteValue.type !== 'undefined' && value === undefined) {
            throw new Error('Could not serialize referenced object');
        }
        return value;
    }
    asElement() {
        return null;
    }
    async dispose() {
        if (this.#disposed) {
            return;
        }
        this.#disposed = true;
        if ('handle' in this.#remoteValue) {
            await releaseReference(this.#realm, this.#remoteValue);
        }
    }
    get isPrimitiveValue() {
        switch (this.#remoteValue.type) {
            case 'string':
            case 'number':
            case 'bigint':
            case 'boolean':
            case 'undefined':
            case 'null':
                return true;
            default:
                return false;
        }
    }
    toString() {
        if (this.isPrimitiveValue) {
            return 'JSHandle:' + BidiSerializer.deserialize(this.#remoteValue);
        }
        return 'JSHandle@' + this.#remoteValue.type;
    }
    get id() {
        return 'handle' in this.#remoteValue ? this.#remoteValue.handle : undefined;
    }
    remoteValue() {
        return this.#remoteValue;
    }
}

/**
 * Copyright 2023 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @internal
 */
class ElementHandle extends index.ElementHandle {
    #frame;
    constructor(realm, remoteValue, frame) {
        super(new JSHandle(realm, remoteValue));
        this.#frame = frame;
    }
    get frame() {
        return this.#frame;
    }
    context() {
        return this.handle.context();
    }
    get isPrimitiveValue() {
        return this.handle.isPrimitiveValue;
    }
    remoteValue() {
        return this.handle.remoteValue();
    }
    /**
     * @internal
     */
    assertElementHasWorld() {
        // TODO: Should assert element has a Sandbox
        return;
    }
    async autofill(data) {
        const client = this.#frame.context().cdpSession;
        const nodeInfo = await client.send('DOM.describeNode', {
            objectId: this.handle.id,
        });
        const fieldId = nodeInfo.node.backendNodeId;
        const frameId = this.#frame._id;
        await client.send('Autofill.trigger', {
            fieldId,
            frameId,
            card: data.creditCard,
        });
    }
    // ///////////////////
    // // Input methods //
    // ///////////////////
    async click(options) {
        await this.scrollIntoViewIfNeeded();
        const { x = 0, y = 0 } = options?.offset ?? {};
        const remoteValue = this.remoteValue();
        index.assert('sharedId' in remoteValue);
        return this.#frame.page().mouse.click(x, y, Object.assign({}, options, {
            origin: {
                type: 'element',
                element: remoteValue,
            },
        }));
    }
    async hover() {
        await this.scrollIntoViewIfNeeded();
        const remoteValue = this.remoteValue();
        index.assert('sharedId' in remoteValue);
        return this.#frame.page().mouse.move(0, 0, {
            origin: {
                type: 'element',
                element: remoteValue,
            },
        });
    }
    async tap() {
        await this.scrollIntoViewIfNeeded();
        const remoteValue = this.remoteValue();
        index.assert('sharedId' in remoteValue);
        return this.#frame.page().touchscreen.tap(0, 0, {
            origin: {
                type: 'element',
                element: remoteValue,
            },
        });
    }
    async touchStart() {
        await this.scrollIntoViewIfNeeded();
        const remoteValue = this.remoteValue();
        index.assert('sharedId' in remoteValue);
        return this.#frame.page().touchscreen.touchStart(0, 0, {
            origin: {
                type: 'element',
                element: remoteValue,
            },
        });
    }
    async touchMove() {
        await this.scrollIntoViewIfNeeded();
        const remoteValue = this.remoteValue();
        index.assert('sharedId' in remoteValue);
        return this.#frame.page().touchscreen.touchMove(0, 0, {
            origin: {
                type: 'element',
                element: remoteValue,
            },
        });
    }
    async touchEnd() {
        await this.scrollIntoViewIfNeeded();
        await this.#frame.page().touchscreen.touchEnd();
    }
    async type(text, options) {
        await this.focus();
        await this.#frame.page().keyboard.type(text, options);
    }
    async press(key, options) {
        await this.focus();
        await this.#frame.page().keyboard.press(key, options);
    }
}

const SOURCE_URL_REGEX = /^[\040\t]*\/\/[@#] sourceURL=\s*(\S*?)\s*$/m;
const getSourceUrlComment = (url) => {
    return `//# sourceURL=${url}`;
};
let Realm$1 = class Realm extends index.EventEmitter {
    connection;
    #frame;
    #id;
    #sandbox;
    constructor(connection, id, sandbox) {
        super();
        this.connection = connection;
        this.#id = id;
        this.#sandbox = sandbox;
    }
    get target() {
        return {
            context: this.#id,
            sandbox: this.#sandbox,
        };
    }
    setFrame(frame) {
        this.#frame = frame;
    }
    internalPuppeteerUtil;
    get puppeteerUtil() {
        const promise = Promise.resolve();
        index.scriptInjector.inject(script => {
            if (this.internalPuppeteerUtil) {
                void this.internalPuppeteerUtil.then(handle => {
                    void handle.dispose();
                });
            }
            this.internalPuppeteerUtil = promise.then(() => {
                return this.evaluateHandle(script);
            });
        }, !this.internalPuppeteerUtil);
        return this.internalPuppeteerUtil;
    }
    async evaluateHandle(pageFunction, ...args) {
        return this.#evaluate(false, pageFunction, ...args);
    }
    async evaluate(pageFunction, ...args) {
        return this.#evaluate(true, pageFunction, ...args);
    }
    async #evaluate(returnByValue, pageFunction, ...args) {
        const sourceUrlComment = getSourceUrlComment(index.getSourcePuppeteerURLIfAvailable(pageFunction)?.toString() ??
            index.PuppeteerURL.INTERNAL_URL);
        let responsePromise;
        const resultOwnership = returnByValue ? 'none' : 'root';
        if (index.isString(pageFunction)) {
            const expression = SOURCE_URL_REGEX.test(pageFunction)
                ? pageFunction
                : `${pageFunction}\n${sourceUrlComment}\n`;
            responsePromise = this.connection.send('script.evaluate', {
                expression,
                target: this.target,
                resultOwnership,
                awaitPromise: true,
            });
        }
        else {
            let functionDeclaration = index.stringifyFunction(pageFunction);
            functionDeclaration = SOURCE_URL_REGEX.test(functionDeclaration)
                ? functionDeclaration
                : `${functionDeclaration}\n${sourceUrlComment}\n`;
            responsePromise = this.connection.send('script.callFunction', {
                functionDeclaration,
                arguments: await Promise.all(args.map(arg => {
                    return BidiSerializer.serialize(arg, this);
                })),
                target: this.target,
                resultOwnership,
                awaitPromise: true,
            });
        }
        const { result } = await responsePromise;
        if ('type' in result && result.type === 'exception') {
            throw createEvaluationError(result.exceptionDetails);
        }
        return returnByValue
            ? BidiSerializer.deserialize(result.result)
            : getBidiHandle(this, result.result, this.#frame);
    }
};
/**
 * @internal
 */
function getBidiHandle(realmOrContext, result, frame) {
    if (result.type === 'node' || result.type === 'window') {
        return new ElementHandle(realmOrContext, result, frame);
    }
    return new JSHandle(realmOrContext, result);
}

/**
 * @internal
 */
const lifeCycleToSubscribedEvent = new Map([
    ['load', 'browsingContext.load'],
    ['domcontentloaded', 'browsingContext.domContentLoaded'],
]);
/**
 * @internal
 */
const lifeCycleToReadinessState = new Map([
    ['load', 'complete'],
    ['domcontentloaded', 'interactive'],
]);
/**
 * @internal
 */
class CDPSessionWrapper extends index.EventEmitter {
    #context;
    #sessionId = index.Deferred.create();
    constructor(context) {
        super();
        this.#context = context;
        context.connection
            .send('cdp.getSession', {
            context: context.id,
        })
            .then(session => {
            this.#sessionId.resolve(session.result.session);
        })
            .catch(err => {
            this.#sessionId.reject(err);
        });
    }
    connection() {
        return undefined;
    }
    async send(method, ...paramArgs) {
        const session = await this.#sessionId.valueOrThrow();
        const result = await this.#context.connection.send('cdp.sendCommand', {
            method: method,
            params: paramArgs[0],
            session,
        });
        return result.result;
    }
    detach() {
        throw new Error('Method not implemented.');
    }
    id() {
        const val = this.#sessionId.value();
        return val instanceof Error || val === undefined ? '' : val;
    }
}
/**
 * @internal
 */
class BrowsingContext extends Realm$1 {
    #timeoutSettings;
    #id;
    #url;
    #cdpSession;
    constructor(connection, timeoutSettings, info) {
        super(connection, info.context);
        this.connection = connection;
        this.#timeoutSettings = timeoutSettings;
        this.#id = info.context;
        this.#url = info.url;
        this.#cdpSession = new CDPSessionWrapper(this);
        this.on('browsingContext.fragmentNavigated', (info) => {
            this.#url = info.url;
        });
    }
    createSandboxRealm(sandbox) {
        return new Realm$1(this.connection, this.#id, sandbox);
    }
    get url() {
        return this.#url;
    }
    get id() {
        return this.#id;
    }
    get cdpSession() {
        return this.#cdpSession;
    }
    navigated(url) {
        this.#url = url;
    }
    async goto(url, options = {}) {
        const { waitUntil = 'load', timeout = this.#timeoutSettings.navigationTimeout(), } = options;
        const readinessState = lifeCycleToReadinessState.get(getWaitUntilSingle(waitUntil));
        try {
            const { result } = await index.waitWithTimeout(this.connection.send('browsingContext.navigate', {
                url: url,
                context: this.#id,
                wait: readinessState,
            }), 'Navigation', timeout);
            this.#url = result.url;
            return result.navigation;
        }
        catch (error) {
            if (error instanceof index.ProtocolError) {
                error.message += ` at ${url}`;
            }
            else if (error instanceof index.TimeoutError) {
                error.message = 'Navigation timeout of ' + timeout + ' ms exceeded';
            }
            throw error;
        }
    }
    async reload(options = {}) {
        const { waitUntil = 'load', timeout = this.#timeoutSettings.navigationTimeout(), } = options;
        const readinessState = lifeCycleToReadinessState.get(getWaitUntilSingle(waitUntil));
        await index.waitWithTimeout(this.connection.send('browsingContext.reload', {
            context: this.#id,
            wait: readinessState,
        }), 'Navigation', timeout);
    }
    async setContent(html, options) {
        const { waitUntil = 'load', timeout = this.#timeoutSettings.navigationTimeout(), } = options;
        const waitUntilEvent = lifeCycleToSubscribedEvent.get(getWaitUntilSingle(waitUntil));
        await Promise.all([
            index.setPageContent(this, html),
            index.waitWithTimeout(new Promise(resolve => {
                this.once(waitUntilEvent, () => {
                    resolve();
                });
            }), waitUntilEvent, timeout),
        ]);
    }
    async content() {
        return await this.evaluate(index.getPageContent);
    }
    async sendCDPCommand(method, ...paramArgs) {
        return this.#cdpSession.send(method, ...paramArgs);
    }
    title() {
        return this.evaluate(() => {
            return document.title;
        });
    }
    dispose() {
        this.removeAllListeners();
        this.connection.unregisterBrowsingContexts(this.#id);
    }
}
/**
 * @internal
 */
function getWaitUntilSingle(event) {
    if (Array.isArray(event) && event.length > 1) {
        throw new Error('BiDi support only single `waitUntil` argument');
    }
    const waitUntilSingle = Array.isArray(event)
        ? event.find(lifecycle => {
            return lifecycle === 'domcontentloaded' || lifecycle === 'load';
        })
        : event;
    if (waitUntilSingle === 'networkidle0' ||
        waitUntilSingle === 'networkidle2') {
        throw new Error(`BiDi does not support 'waitUntil' ${waitUntilSingle}`);
    }
    index.assert(waitUntilSingle, `Invalid waitUntil option ${waitUntilSingle}`);
    return waitUntilSingle;
}

var protocol = {};

(function (exports) {
	/**
	 * Copyright 2022 Google LLC.
	 * Copyright (c) Microsoft Corporation.
	 *
	 * Licensed under the Apache License, Version 2.0 (the "License");
	 * you may not use this file except in compliance with the License.
	 * You may obtain a copy of the License at
	 *
	 *     http://www.apache.org/licenses/LICENSE-2.0
	 *
	 * Unless required by applicable law or agreed to in writing, software
	 * distributed under the License is distributed on an "AS IS" BASIS,
	 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	 * See the License for the specific language governing permissions and
	 * limitations under the License.
	 */
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Input = exports.Network = exports.Log = exports.BrowsingContext = exports.Script = exports.Message = void 0;
	(function (Message) {
	    // keep-sorted end
	    let ErrorCode;
	    (function (ErrorCode) {
	        // keep-sorted start
	        ErrorCode["InvalidArgument"] = "invalid argument";
	        ErrorCode["InvalidSessionId"] = "invalid session id";
	        ErrorCode["MoveTargetOutOfBounds"] = "move target out of bounds";
	        ErrorCode["NoSuchAlert"] = "no such alert";
	        ErrorCode["NoSuchElement"] = "no such element";
	        ErrorCode["NoSuchFrame"] = "no such frame";
	        ErrorCode["NoSuchHandle"] = "no such handle";
	        ErrorCode["NoSuchNode"] = "no such node";
	        ErrorCode["NoSuchScript"] = "no such script";
	        ErrorCode["SessionNotCreated"] = "session not created";
	        ErrorCode["UnknownCommand"] = "unknown command";
	        ErrorCode["UnknownError"] = "unknown error";
	        ErrorCode["UnsupportedOperation"] = "unsupported operation";
	        // keep-sorted end
	    })(ErrorCode = Message.ErrorCode || (Message.ErrorCode = {}));
	    class ErrorResponse {
	        error;
	        message;
	        stacktrace;
	        constructor(error, message, stacktrace) {
	            this.error = error;
	            this.message = message;
	            this.stacktrace = stacktrace;
	        }
	        toErrorResponse(commandId) {
	            return {
	                id: commandId,
	                error: this.error,
	                message: this.message,
	                stacktrace: this.stacktrace,
	            };
	        }
	    }
	    Message.ErrorResponse = ErrorResponse;
	    class InvalidArgumentException extends ErrorResponse {
	        constructor(message, stacktrace) {
	            super(ErrorCode.InvalidArgument, message, stacktrace);
	        }
	    }
	    Message.InvalidArgumentException = InvalidArgumentException;
	    class MoveTargetOutOfBoundsException extends ErrorResponse {
	        constructor(message, stacktrace) {
	            super(ErrorCode.MoveTargetOutOfBounds, message, stacktrace);
	        }
	    }
	    Message.MoveTargetOutOfBoundsException = MoveTargetOutOfBoundsException;
	    class NoSuchHandleException extends ErrorResponse {
	        constructor(message, stacktrace) {
	            super(ErrorCode.NoSuchHandle, message, stacktrace);
	        }
	    }
	    Message.NoSuchHandleException = NoSuchHandleException;
	    class InvalidSessionIdException extends ErrorResponse {
	        constructor(message, stacktrace) {
	            super(ErrorCode.InvalidSessionId, message, stacktrace);
	        }
	    }
	    Message.InvalidSessionIdException = InvalidSessionIdException;
	    class NoSuchAlertException extends ErrorResponse {
	        constructor(message, stacktrace) {
	            super(ErrorCode.NoSuchAlert, message, stacktrace);
	        }
	    }
	    Message.NoSuchAlertException = NoSuchAlertException;
	    class NoSuchFrameException extends ErrorResponse {
	        constructor(message) {
	            super(ErrorCode.NoSuchFrame, message);
	        }
	    }
	    Message.NoSuchFrameException = NoSuchFrameException;
	    class NoSuchNodeException extends ErrorResponse {
	        constructor(message, stacktrace) {
	            super(ErrorCode.NoSuchNode, message, stacktrace);
	        }
	    }
	    Message.NoSuchNodeException = NoSuchNodeException;
	    class NoSuchElementException extends ErrorResponse {
	        constructor(message, stacktrace) {
	            super(ErrorCode.NoSuchElement, message, stacktrace);
	        }
	    }
	    Message.NoSuchElementException = NoSuchElementException;
	    class NoSuchScriptException extends ErrorResponse {
	        constructor(message, stacktrace) {
	            super(ErrorCode.NoSuchScript, message, stacktrace);
	        }
	    }
	    Message.NoSuchScriptException = NoSuchScriptException;
	    class SessionNotCreatedException extends ErrorResponse {
	        constructor(message, stacktrace) {
	            super(ErrorCode.SessionNotCreated, message, stacktrace);
	        }
	    }
	    Message.SessionNotCreatedException = SessionNotCreatedException;
	    class UnknownCommandException extends ErrorResponse {
	        constructor(message, stacktrace) {
	            super(ErrorCode.UnknownCommand, message, stacktrace);
	        }
	    }
	    Message.UnknownCommandException = UnknownCommandException;
	    class UnknownErrorException extends ErrorResponse {
	        constructor(message, stacktrace) {
	            super(ErrorCode.UnknownError, message, stacktrace);
	        }
	    }
	    Message.UnknownErrorException = UnknownErrorException;
	    class UnsupportedOperationException extends ErrorResponse {
	        constructor(message, stacktrace) {
	            super(ErrorCode.UnsupportedOperation, message, stacktrace);
	        }
	    }
	    Message.UnsupportedOperationException = UnsupportedOperationException;
	})(exports.Message || (exports.Message = {}));
	(function (Script) {
	    (function (EventNames) {
	        // keep-sorted start
	        EventNames["MessageEvent"] = "script.message";
	        EventNames["RealmCreated"] = "script.realmCreated";
	        EventNames["RealmDestroyed"] = "script.realmDestroyed";
	        // keep-sorted end
	    })(Script.EventNames || (Script.EventNames = {}));
	    Script.AllEvents = 'script';
	})(exports.Script || (exports.Script = {}));
	(function (BrowsingContext) {
	    (function (EventNames) {
	        // keep-sorted start
	        EventNames["ContextCreatedEvent"] = "browsingContext.contextCreated";
	        EventNames["ContextDestroyedEvent"] = "browsingContext.contextDestroyed";
	        EventNames["DomContentLoadedEvent"] = "browsingContext.domContentLoaded";
	        EventNames["FragmentNavigated"] = "browsingContext.fragmentNavigated";
	        EventNames["LoadEvent"] = "browsingContext.load";
	        EventNames["NavigationStarted"] = "browsingContext.navigationStarted";
	        // keep-sorted end
	    })(BrowsingContext.EventNames || (BrowsingContext.EventNames = {}));
	    BrowsingContext.AllEvents = 'browsingContext';
	})(exports.BrowsingContext || (exports.BrowsingContext = {}));
	(function (Log) {
	    Log.AllEvents = 'log';
	    (function (EventNames) {
	        EventNames["LogEntryAddedEvent"] = "log.entryAdded";
	    })(Log.EventNames || (Log.EventNames = {}));
	})(exports.Log || (exports.Log = {}));
	(function (Network) {
	    Network.AllEvents = 'network';
	    (function (EventNames) {
	        EventNames["BeforeRequestSentEvent"] = "network.beforeRequestSent";
	        EventNames["FetchErrorEvent"] = "network.fetchError";
	        EventNames["ResponseStartedEvent"] = "network.responseStarted";
	        EventNames["ResponseCompletedEvent"] = "network.responseCompleted";
	    })(Network.EventNames || (Network.EventNames = {}));
	})(exports.Network || (exports.Network = {}));
	(function (Input) {
	    (function (SourceActionsType) {
	        SourceActionsType["None"] = "none";
	        SourceActionsType["Key"] = "key";
	        SourceActionsType["Pointer"] = "pointer";
	        SourceActionsType["Wheel"] = "wheel";
	    })(Input.SourceActionsType || (Input.SourceActionsType = {}));
	    (function (PointerType) {
	        PointerType["Mouse"] = "mouse";
	        PointerType["Pen"] = "pen";
	        PointerType["Touch"] = "touch";
	    })(Input.PointerType || (Input.PointerType = {}));
	    (function (ActionType) {
	        ActionType["Pause"] = "pause";
	        ActionType["KeyDown"] = "keyDown";
	        ActionType["KeyUp"] = "keyUp";
	        ActionType["PointerUp"] = "pointerUp";
	        ActionType["PointerDown"] = "pointerDown";
	        ActionType["PointerMove"] = "pointerMove";
	        ActionType["Scroll"] = "scroll";
	    })(Input.ActionType || (Input.ActionType = {}));
	})(exports.Input || (exports.Input = {}));
	
} (protocol));

/**
 * Copyright 2023 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * A unique key for {@link SandboxChart} to denote the default world.
 * Realms are automatically created in the default sandbox.
 *
 * @internal
 */
const MAIN_SANDBOX = Symbol('mainSandbox');
/**
 * A unique key for {@link SandboxChart} to denote the puppeteer sandbox.
 * This world contains all puppeteer-internal bindings/code.
 *
 * @internal
 */
const PUPPETEER_SANDBOX = Symbol('puppeteerSandbox');
/**
 * @internal
 */
class Sandbox {
    #document;
    #realm;
    #timeoutSettings;
    #taskManager = new index.TaskManager();
    constructor(context, timeoutSettings) {
        this.#realm = context;
        this.#timeoutSettings = timeoutSettings;
    }
    get taskManager() {
        return this.#taskManager;
    }
    async document() {
        if (this.#document) {
            return this.#document;
        }
        this.#document = await this.#realm.evaluateHandle(() => {
            return document;
        });
        return this.#document;
    }
    async $(selector) {
        const document = await this.document();
        return document.$(selector);
    }
    async $$(selector) {
        const document = await this.document();
        return document.$$(selector);
    }
    async $eval(selector, pageFunction, ...args) {
        pageFunction = index.withSourcePuppeteerURLIfNone(this.$eval.name, pageFunction);
        const document = await this.document();
        return document.$eval(selector, pageFunction, ...args);
    }
    async $$eval(selector, pageFunction, ...args) {
        pageFunction = index.withSourcePuppeteerURLIfNone(this.$$eval.name, pageFunction);
        const document = await this.document();
        return document.$$eval(selector, pageFunction, ...args);
    }
    async $x(expression) {
        const document = await this.document();
        return document.$x(expression);
    }
    async evaluateHandle(pageFunction, ...args) {
        pageFunction = index.withSourcePuppeteerURLIfNone(this.evaluateHandle.name, pageFunction);
        return this.#realm.evaluateHandle(pageFunction, ...args);
    }
    async evaluate(pageFunction, ...args) {
        pageFunction = index.withSourcePuppeteerURLIfNone(this.evaluate.name, pageFunction);
        return this.#realm.evaluate(pageFunction, ...args);
    }
    async adoptHandle(handle) {
        return (await this.evaluateHandle(node => {
            return node;
        }, handle));
    }
    async transferHandle(handle) {
        if (handle.context() === this.#realm) {
            return handle;
        }
        const transferredHandle = await this.evaluateHandle(node => {
            return node;
        }, handle);
        await handle.dispose();
        return transferredHandle;
    }
    waitForFunction(pageFunction, options = {}, ...args) {
        const { polling = 'raf', timeout = this.#timeoutSettings.timeout(), root, signal, } = options;
        if (typeof polling === 'number' && polling < 0) {
            throw new Error('Cannot poll with non-positive interval');
        }
        const waitTask = new index.WaitTask(this, {
            polling,
            root,
            timeout,
            signal,
        }, pageFunction, ...args);
        return waitTask.result;
    }
    // ///////////////////
    // // Input methods //
    // ///////////////////
    async click(selector, options) {
        const handle = await this.$(selector);
        index.assert(handle, `No element found for selector: ${selector}`);
        await handle.click(options);
        await handle.dispose();
    }
    async focus(selector) {
        const handle = await this.$(selector);
        index.assert(handle, `No element found for selector: ${selector}`);
        await handle.focus();
        await handle.dispose();
    }
    async hover(selector) {
        const handle = await this.$(selector);
        index.assert(handle, `No element found for selector: ${selector}`);
        await handle.hover();
        await handle.dispose();
    }
    async select(selector, ...values) {
        const handle = await this.$(selector);
        index.assert(handle, `No element found for selector: ${selector}`);
        const result = await handle.select(...values);
        await handle.dispose();
        return result;
    }
    async tap(selector) {
        const handle = await this.$(selector);
        index.assert(handle, `No element found for selector: ${selector}`);
        await handle.tap();
        await handle.dispose();
    }
    async type(selector, text, options) {
        const handle = await this.$(selector);
        index.assert(handle, `No element found for selector: ${selector}`);
        await handle.type(text, options);
        await handle.dispose();
    }
}

/**
 * Copyright 2023 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * Puppeteer's Frame class could be viewed as a BiDi BrowsingContext implementation
 * @internal
 */
class Frame extends index.Frame {
    #page;
    #context;
    #timeoutSettings;
    #abortDeferred = index.Deferred.create();
    sandboxes;
    _id;
    constructor(page, context, timeoutSettings, parentId) {
        super();
        this.#page = page;
        this.#context = context;
        this.#timeoutSettings = timeoutSettings;
        this._id = this.#context.id;
        this._parentId = parentId ?? undefined;
        const puppeteerRealm = context.createSandboxRealm(index.UTILITY_WORLD_NAME);
        this.sandboxes = {
            [MAIN_SANDBOX]: new Sandbox(context, timeoutSettings),
            [PUPPETEER_SANDBOX]: new Sandbox(puppeteerRealm, timeoutSettings),
        };
        puppeteerRealm.setFrame(this);
        context.setFrame(this);
    }
    mainRealm() {
        return this.sandboxes[MAIN_SANDBOX];
    }
    isolatedRealm() {
        return this.sandboxes[PUPPETEER_SANDBOX];
    }
    page() {
        return this.#page;
    }
    name() {
        return this._name || '';
    }
    url() {
        return this.#context.url;
    }
    parentFrame() {
        return this.#page.frame(this._parentId ?? '');
    }
    childFrames() {
        return this.#page.childFrames(this.#context.id);
    }
    async evaluateHandle(pageFunction, ...args) {
        return this.#context.evaluateHandle(pageFunction, ...args);
    }
    async evaluate(pageFunction, ...args) {
        return this.#context.evaluate(pageFunction, ...args);
    }
    async goto(url, options) {
        const navigationId = await this.#context.goto(url, options);
        return this.#page.getNavigationResponse(navigationId);
    }
    setContent(html, options) {
        return this.#context.setContent(html, options);
    }
    content() {
        return this.#context.content();
    }
    title() {
        return this.#context.title();
    }
    context() {
        return this.#context;
    }
    $(selector) {
        return this.mainRealm().$(selector);
    }
    $$(selector) {
        return this.mainRealm().$$(selector);
    }
    $eval(selector, pageFunction, ...args) {
        pageFunction = index.withSourcePuppeteerURLIfNone(this.$eval.name, pageFunction);
        return this.mainRealm().$eval(selector, pageFunction, ...args);
    }
    $$eval(selector, pageFunction, ...args) {
        pageFunction = index.withSourcePuppeteerURLIfNone(this.$$eval.name, pageFunction);
        return this.mainRealm().$$eval(selector, pageFunction, ...args);
    }
    $x(expression) {
        return this.mainRealm().$x(expression);
    }
    async waitForNavigation(options = {}) {
        const { waitUntil = 'load', timeout = this.#timeoutSettings.navigationTimeout(), } = options;
        const waitUntilEvent = lifeCycleToSubscribedEvent.get(getWaitUntilSingle(waitUntil));
        const [info] = await Promise.all([
            index.waitForEvent(this.#context, waitUntilEvent, () => {
                return true;
            }, timeout, this.#abortDeferred.valueOrThrow()),
            index.waitForEvent(this.#context, protocol.BrowsingContext.EventNames.FragmentNavigated, () => {
                return true;
            }, timeout, this.#abortDeferred.valueOrThrow()),
        ]);
        return this.#page.getNavigationResponse(info.navigation);
    }
    dispose() {
        this.#abortDeferred.reject(new Error('Frame detached'));
        this.#context.dispose();
    }
}

/**
 * Copyright 2017 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const getBidiKeyValue = (key) => {
    switch (key) {
        case '\r':
        case '\n':
            key = 'Enter';
            break;
    }
    // Measures the number of code points rather than UTF-16 code units.
    if ([...key].length === 1) {
        return key;
    }
    switch (key) {
        case 'Cancel':
            return '\uE001';
        case 'Help':
            return '\uE002';
        case 'Backspace':
            return '\uE003';
        case 'Tab':
            return '\uE004';
        case 'Clear':
            return '\uE005';
        case 'Enter':
            return '\uE007';
        case 'Shift':
        case 'ShiftLeft':
            return '\uE008';
        case 'Control':
        case 'ControlLeft':
            return '\uE009';
        case 'Alt':
        case 'AltLeft':
            return '\uE00A';
        case 'Pause':
            return '\uE00B';
        case 'Escape':
            return '\uE00C';
        case 'PageUp':
            return '\uE00E';
        case 'PageDown':
            return '\uE00F';
        case 'End':
            return '\uE010';
        case 'Home':
            return '\uE011';
        case 'ArrowLeft':
            return '\uE012';
        case 'ArrowUp':
            return '\uE013';
        case 'ArrowRight':
            return '\uE014';
        case 'ArrowDown':
            return '\uE015';
        case 'Insert':
            return '\uE016';
        case 'Delete':
            return '\uE017';
        case 'NumpadEqual':
            return '\uE019';
        case 'Numpad0':
            return '\uE01A';
        case 'Numpad1':
            return '\uE01B';
        case 'Numpad2':
            return '\uE01C';
        case 'Numpad3':
            return '\uE01D';
        case 'Numpad4':
            return '\uE01E';
        case 'Numpad5':
            return '\uE01F';
        case 'Numpad6':
            return '\uE020';
        case 'Numpad7':
            return '\uE021';
        case 'Numpad8':
            return '\uE022';
        case 'Numpad9':
            return '\uE023';
        case 'NumpadMultiply':
            return '\uE024';
        case 'NumpadAdd':
            return '\uE025';
        case 'NumpadSubtract':
            return '\uE027';
        case 'NumpadDecimal':
            return '\uE028';
        case 'NumpadDivide':
            return '\uE029';
        case 'F1':
            return '\uE031';
        case 'F2':
            return '\uE032';
        case 'F3':
            return '\uE033';
        case 'F4':
            return '\uE034';
        case 'F5':
            return '\uE035';
        case 'F6':
            return '\uE036';
        case 'F7':
            return '\uE037';
        case 'F8':
            return '\uE038';
        case 'F9':
            return '\uE039';
        case 'F10':
            return '\uE03A';
        case 'F11':
            return '\uE03B';
        case 'F12':
            return '\uE03C';
        case 'Meta':
        case 'MetaLeft':
            return '\uE03D';
        case 'ShiftRight':
            return '\uE050';
        case 'ControlRight':
            return '\uE051';
        case 'AltRight':
            return '\uE052';
        case 'MetaRight':
            return '\uE053';
        case 'Digit0':
            return '0';
        case 'Digit1':
            return '1';
        case 'Digit2':
            return '2';
        case 'Digit3':
            return '3';
        case 'Digit4':
            return '4';
        case 'Digit5':
            return '5';
        case 'Digit6':
            return '6';
        case 'Digit7':
            return '7';
        case 'Digit8':
            return '8';
        case 'Digit9':
            return '9';
        case 'KeyA':
            return 'a';
        case 'KeyB':
            return 'b';
        case 'KeyC':
            return 'c';
        case 'KeyD':
            return 'd';
        case 'KeyE':
            return 'e';
        case 'KeyF':
            return 'f';
        case 'KeyG':
            return 'g';
        case 'KeyH':
            return 'h';
        case 'KeyI':
            return 'i';
        case 'KeyJ':
            return 'j';
        case 'KeyK':
            return 'k';
        case 'KeyL':
            return 'l';
        case 'KeyM':
            return 'm';
        case 'KeyN':
            return 'n';
        case 'KeyO':
            return 'o';
        case 'KeyP':
            return 'p';
        case 'KeyQ':
            return 'q';
        case 'KeyR':
            return 'r';
        case 'KeyS':
            return 's';
        case 'KeyT':
            return 't';
        case 'KeyU':
            return 'u';
        case 'KeyV':
            return 'v';
        case 'KeyW':
            return 'w';
        case 'KeyX':
            return 'x';
        case 'KeyY':
            return 'y';
        case 'KeyZ':
            return 'z';
        case 'Semicolon':
            return ';';
        case 'Equal':
            return '=';
        case 'Comma':
            return ',';
        case 'Minus':
            return '-';
        case 'Period':
            return '.';
        case 'Slash':
            return '/';
        case 'Backquote':
            return '`';
        case 'BracketLeft':
            return '[';
        case 'Backslash':
            return '\\';
        case 'BracketRight':
            return ']';
        case 'Quote':
            return '"';
        default:
            throw new Error(`Unknown key: "${key}"`);
    }
};
/**
 * @internal
 */
class Keyboard extends index.Keyboard {
    #context;
    /**
     * @internal
     */
    constructor(context) {
        super();
        this.#context = context;
    }
    async down(key, _options) {
        await this.#context.connection.send('input.performActions', {
            context: this.#context.id,
            actions: [
                {
                    type: protocol.Input.SourceActionsType.Key,
                    id: "__puppeteer_keyboard" /* InputId.Keyboard */,
                    actions: [
                        {
                            type: protocol.Input.ActionType.KeyDown,
                            value: getBidiKeyValue(key),
                        },
                    ],
                },
            ],
        });
    }
    async up(key) {
        await this.#context.connection.send('input.performActions', {
            context: this.#context.id,
            actions: [
                {
                    type: protocol.Input.SourceActionsType.Key,
                    id: "__puppeteer_keyboard" /* InputId.Keyboard */,
                    actions: [
                        {
                            type: protocol.Input.ActionType.KeyUp,
                            value: getBidiKeyValue(key),
                        },
                    ],
                },
            ],
        });
    }
    async press(key, options = {}) {
        const { delay = 0 } = options;
        const actions = [
            {
                type: protocol.Input.ActionType.KeyDown,
                value: getBidiKeyValue(key),
            },
        ];
        if (delay > 0) {
            actions.push({
                type: protocol.Input.ActionType.Pause,
                duration: delay,
            });
        }
        actions.push({
            type: protocol.Input.ActionType.KeyUp,
            value: getBidiKeyValue(key),
        });
        await this.#context.connection.send('input.performActions', {
            context: this.#context.id,
            actions: [
                {
                    type: protocol.Input.SourceActionsType.Key,
                    id: "__puppeteer_keyboard" /* InputId.Keyboard */,
                    actions,
                },
            ],
        });
    }
    async type(text, options = {}) {
        const { delay = 0 } = options;
        // This spread separates the characters into code points rather than UTF-16
        // code units.
        const values = [...text].map(getBidiKeyValue);
        const actions = [];
        if (delay <= 0) {
            for (const value of values) {
                actions.push({
                    type: protocol.Input.ActionType.KeyDown,
                    value,
                }, {
                    type: protocol.Input.ActionType.KeyUp,
                    value,
                });
            }
        }
        else {
            for (const value of values) {
                actions.push({
                    type: protocol.Input.ActionType.KeyDown,
                    value,
                }, {
                    type: protocol.Input.ActionType.Pause,
                    duration: delay,
                }, {
                    type: protocol.Input.ActionType.KeyUp,
                    value,
                });
            }
        }
        await this.#context.connection.send('input.performActions', {
            context: this.#context.id,
            actions: [
                {
                    type: protocol.Input.SourceActionsType.Key,
                    id: "__puppeteer_keyboard" /* InputId.Keyboard */,
                    actions,
                },
            ],
        });
    }
}
const getBidiButton = (button) => {
    switch (button) {
        case index.MouseButton.Left:
            return 0;
        case index.MouseButton.Middle:
            return 1;
        case index.MouseButton.Right:
            return 2;
        case index.MouseButton.Back:
            return 3;
        case index.MouseButton.Forward:
            return 4;
    }
};
/**
 * @internal
 */
class Mouse extends index.Mouse {
    #context;
    #lastMovePoint;
    /**
     * @internal
     */
    constructor(context) {
        super();
        this.#context = context;
    }
    async reset() {
        this.#lastMovePoint = undefined;
        await this.#context.connection.send('input.releaseActions', {
            context: this.#context.id,
        });
    }
    async move(x, y, options = {}) {
        this.#lastMovePoint = {
            x,
            y,
        };
        await this.#context.connection.send('input.performActions', {
            context: this.#context.id,
            actions: [
                {
                    type: protocol.Input.SourceActionsType.Pointer,
                    id: "__puppeteer_mouse" /* InputId.Mouse */,
                    actions: [
                        {
                            type: protocol.Input.ActionType.PointerMove,
                            x,
                            y,
                            duration: (options.steps ?? 0) * 50,
                            origin: options.origin,
                        },
                    ],
                },
            ],
        });
    }
    async down(options = {}) {
        await this.#context.connection.send('input.performActions', {
            context: this.#context.id,
            actions: [
                {
                    type: protocol.Input.SourceActionsType.Pointer,
                    id: "__puppeteer_mouse" /* InputId.Mouse */,
                    actions: [
                        {
                            type: protocol.Input.ActionType.PointerDown,
                            button: getBidiButton(options.button ?? index.MouseButton.Left),
                        },
                    ],
                },
            ],
        });
    }
    async up(options = {}) {
        await this.#context.connection.send('input.performActions', {
            context: this.#context.id,
            actions: [
                {
                    type: protocol.Input.SourceActionsType.Pointer,
                    id: "__puppeteer_mouse" /* InputId.Mouse */,
                    actions: [
                        {
                            type: protocol.Input.ActionType.PointerUp,
                            button: getBidiButton(options.button ?? index.MouseButton.Left),
                        },
                    ],
                },
            ],
        });
    }
    async click(x, y, options = {}) {
        const actions = [
            {
                type: protocol.Input.ActionType.PointerMove,
                x,
                y,
                origin: options.origin,
            },
        ];
        const pointerDownAction = {
            type: protocol.Input.ActionType.PointerDown,
            button: getBidiButton(options.button ?? index.MouseButton.Left),
        };
        const pointerUpAction = {
            type: protocol.Input.ActionType.PointerUp,
            button: pointerDownAction.button,
        };
        for (let i = 1; i < (options.count ?? 1); ++i) {
            actions.push(pointerDownAction, pointerUpAction);
        }
        actions.push(pointerDownAction);
        if (options.delay) {
            actions.push({
                type: protocol.Input.ActionType.Pause,
                duration: options.delay,
            });
        }
        actions.push(pointerUpAction);
        await this.#context.connection.send('input.performActions', {
            context: this.#context.id,
            actions: [
                {
                    type: protocol.Input.SourceActionsType.Pointer,
                    id: "__puppeteer_mouse" /* InputId.Mouse */,
                    actions,
                },
            ],
        });
    }
    async wheel(options = {}) {
        await this.#context.connection.send('input.performActions', {
            context: this.#context.id,
            actions: [
                {
                    type: protocol.Input.SourceActionsType.Wheel,
                    id: "__puppeteer_wheel" /* InputId.Wheel */,
                    actions: [
                        {
                            type: protocol.Input.ActionType.Scroll,
                            ...(this.#lastMovePoint ?? {
                                x: 0,
                                y: 0,
                            }),
                            deltaX: options.deltaX ?? 0,
                            deltaY: options.deltaY ?? 0,
                        },
                    ],
                },
            ],
        });
    }
}
/**
 * @internal
 */
class Touchscreen extends index.Touchscreen {
    #context;
    /**
     * @internal
     */
    constructor(context) {
        super();
        this.#context = context;
    }
    async tap(x, y, options = {}) {
        await this.touchStart(x, y, options);
        await this.touchEnd();
    }
    async touchStart(x, y, options = {}) {
        await this.#context.connection.send('input.performActions', {
            context: this.#context.id,
            actions: [
                {
                    type: protocol.Input.SourceActionsType.Pointer,
                    id: "__puppeteer_finger" /* InputId.Finger */,
                    parameters: {
                        pointerType: protocol.Input.PointerType.Touch,
                    },
                    actions: [
                        {
                            type: protocol.Input.ActionType.PointerMove,
                            x,
                            y,
                            origin: options.origin,
                        },
                        {
                            type: protocol.Input.ActionType.PointerDown,
                            button: 0,
                        },
                    ],
                },
            ],
        });
    }
    async touchMove(x, y, options = {}) {
        await this.#context.connection.send('input.performActions', {
            context: this.#context.id,
            actions: [
                {
                    type: protocol.Input.SourceActionsType.Pointer,
                    id: "__puppeteer_finger" /* InputId.Finger */,
                    parameters: {
                        pointerType: protocol.Input.PointerType.Touch,
                    },
                    actions: [
                        {
                            type: protocol.Input.ActionType.PointerMove,
                            x,
                            y,
                            origin: options.origin,
                        },
                    ],
                },
            ],
        });
    }
    async touchEnd() {
        await this.#context.connection.send('input.performActions', {
            context: this.#context.id,
            actions: [
                {
                    type: protocol.Input.SourceActionsType.Pointer,
                    id: "__puppeteer_finger" /* InputId.Finger */,
                    parameters: {
                        pointerType: protocol.Input.PointerType.Touch,
                    },
                    actions: [
                        {
                            type: protocol.Input.ActionType.PointerUp,
                            button: 0,
                        },
                    ],
                },
            ],
        });
    }
}

/**
 * @internal
 */
class HTTPRequest extends index.HTTPRequest {
    _response = null;
    _redirectChain;
    _navigationId;
    #url;
    #resourceType;
    #method;
    #postData;
    #headers = {};
    #initiator;
    #frame;
    constructor(event, frame, redirectChain) {
        super();
        this.#url = event.request.url;
        this.#resourceType = event.initiator.type.toLowerCase();
        this.#method = event.request.method;
        this.#postData = undefined;
        this.#initiator = event.initiator;
        this.#frame = frame;
        this._requestId = event.request.request;
        this._redirectChain = redirectChain ?? [];
        this._navigationId = event.navigation;
        for (const { name, value } of event.request.headers) {
            // TODO: How to handle Binary Headers
            // https://w3c.github.io/webdriver-bidi/#type-network-Header
            if (value) {
                this.#headers[name.toLowerCase()] = value;
            }
        }
    }
    url() {
        return this.#url;
    }
    resourceType() {
        return this.#resourceType;
    }
    method() {
        return this.#method;
    }
    postData() {
        return this.#postData;
    }
    headers() {
        return this.#headers;
    }
    response() {
        return this._response;
    }
    isNavigationRequest() {
        return Boolean(this._navigationId);
    }
    initiator() {
        return this.#initiator;
    }
    redirectChain() {
        return this._redirectChain.slice();
    }
    enqueueInterceptAction(pendingHandler) {
        // Execute the handler when interception is not supported
        void pendingHandler();
    }
    frame() {
        return this.#frame;
    }
}

/**
 * @internal
 */
class HTTPResponse extends index.HTTPResponse {
    #request;
    #remoteAddress;
    #status;
    #statusText;
    #url;
    #fromCache;
    #headers = {};
    #timings;
    constructor(request, responseEvent) {
        super();
        const { response } = responseEvent;
        this.#request = request;
        this.#remoteAddress = {
            ip: '',
            port: -1,
        };
        this.#url = response.url;
        this.#fromCache = response.fromCache;
        this.#status = response.status;
        this.#statusText = response.statusText;
        // TODO: update once BiDi has types
        this.#timings = response.timings ?? null;
        // TODO: Removed once the Firefox implementation is compliant with https://w3c.github.io/webdriver-bidi/#get-the-response-data.
        for (const header of response.headers || []) {
            this.#headers[header.name] = header.value ?? '';
        }
    }
    remoteAddress() {
        return this.#remoteAddress;
    }
    url() {
        return this.#url;
    }
    status() {
        return this.#status;
    }
    statusText() {
        return this.#statusText;
    }
    headers() {
        return this.#headers;
    }
    request() {
        return this.#request;
    }
    fromCache() {
        return this.#fromCache;
    }
    timing() {
        return this.#timings;
    }
    frame() {
        return this.#request.frame();
    }
}

/**
 * Copyright 2023 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @internal
 */
class NetworkManager extends index.EventEmitter {
    #connection;
    #page;
    #subscribedEvents = new Map([
        ['network.beforeRequestSent', this.#onBeforeRequestSent.bind(this)],
        ['network.responseStarted', this.#onResponseStarted.bind(this)],
        ['network.responseCompleted', this.#onResponseCompleted.bind(this)],
        ['network.fetchError', this.#onFetchError.bind(this)],
    ]);
    #requestMap = new Map();
    #navigationMap = new Map();
    constructor(connection, page) {
        super();
        this.#connection = connection;
        this.#page = page;
        // TODO: Subscribe to the Frame indivutally
        for (const [event, subscriber] of this.#subscribedEvents) {
            this.#connection.on(event, subscriber);
        }
    }
    #onBeforeRequestSent(event) {
        const frame = this.#page.frame(event.context ?? '');
        if (!frame) {
            return;
        }
        const request = this.#requestMap.get(event.request.request);
        let upsertRequest;
        if (request) {
            const requestChain = request._redirectChain;
            upsertRequest = new HTTPRequest(event, frame, requestChain);
        }
        else {
            upsertRequest = new HTTPRequest(event, frame, []);
        }
        this.#requestMap.set(event.request.request, upsertRequest);
        this.emit(index.NetworkManagerEmittedEvents.Request, upsertRequest);
    }
    #onResponseStarted(_event) { }
    #onResponseCompleted(event) {
        const request = this.#requestMap.get(event.request.request);
        if (!request) {
            return;
        }
        const response = new HTTPResponse(request, event);
        request._response = response;
        if (event.navigation) {
            this.#navigationMap.set(event.navigation, response);
        }
        if (response.fromCache()) {
            this.emit(index.NetworkManagerEmittedEvents.RequestServedFromCache, request);
        }
        this.emit(index.NetworkManagerEmittedEvents.Response, response);
        this.emit(index.NetworkManagerEmittedEvents.RequestFinished, request);
        this.#requestMap.delete(event.request.request);
    }
    #onFetchError(event) {
        const request = this.#requestMap.get(event.request.request);
        if (!request) {
            return;
        }
        request._failureText = event.errorText;
        this.emit(index.NetworkManagerEmittedEvents.RequestFailed, request);
        this.#requestMap.delete(event.request.request);
    }
    getNavigationResponse(navigationId) {
        if (!navigationId) {
            return null;
        }
        const response = this.#navigationMap.get(navigationId);
        return response ?? null;
    }
    inFlightRequestsCount() {
        let inFlightRequestCounter = 0;
        for (const request of this.#requestMap.values()) {
            if (!request.response() || request._failureText) {
                inFlightRequestCounter++;
            }
        }
        return inFlightRequestCounter;
    }
    clearMapAfterFrameDispose(frame) {
        for (const [id, request] of this.#requestMap.entries()) {
            if (request.frame() === frame) {
                this.#requestMap.delete(id);
            }
        }
        for (const [id, response] of this.#navigationMap.entries()) {
            if (response.frame() === frame) {
                this.#requestMap.delete(id);
            }
        }
    }
    dispose() {
        this.removeAllListeners();
        this.#requestMap.clear();
        this.#navigationMap.clear();
        for (const [event, subscriber] of this.#subscribedEvents) {
            this.#connection.off(event, subscriber);
        }
    }
}

/**
 * Copyright 2022 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @internal
 */
class Page extends index.Page {
    #accessibility;
    #timeoutSettings = new index.TimeoutSettings();
    #browserContext;
    #connection;
    #frameTree = new index.FrameTree();
    #networkManager;
    #viewport = null;
    #closedDeferred = index.Deferred.create();
    #subscribedEvents = new Map([
        ['log.entryAdded', this.#onLogEntryAdded.bind(this)],
        ['browsingContext.load', this.#onFrameLoaded.bind(this)],
        [
            'browsingContext.domContentLoaded',
            this.#onFrameDOMContentLoaded.bind(this),
        ],
        ['browsingContext.contextCreated', this.#onFrameAttached.bind(this)],
        ['browsingContext.contextDestroyed', this.#onFrameDetached.bind(this)],
        ['browsingContext.fragmentNavigated', this.#onFrameNavigated.bind(this)],
    ]);
    #networkManagerEvents = new Map([
        [
            index.NetworkManagerEmittedEvents.Request,
            this.emit.bind(this, "request" /* PageEmittedEvents.Request */),
        ],
        [
            index.NetworkManagerEmittedEvents.RequestServedFromCache,
            this.emit.bind(this, "requestservedfromcache" /* PageEmittedEvents.RequestServedFromCache */),
        ],
        [
            index.NetworkManagerEmittedEvents.RequestFailed,
            this.emit.bind(this, "requestfailed" /* PageEmittedEvents.RequestFailed */),
        ],
        [
            index.NetworkManagerEmittedEvents.RequestFinished,
            this.emit.bind(this, "requestfinished" /* PageEmittedEvents.RequestFinished */),
        ],
        [
            index.NetworkManagerEmittedEvents.Response,
            this.emit.bind(this, "response" /* PageEmittedEvents.Response */),
        ],
    ]);
    #tracing;
    #coverage;
    #emulationManager;
    #mouse;
    #touchscreen;
    #keyboard;
    constructor(browserContext, info) {
        super();
        this.#browserContext = browserContext;
        this.#connection = browserContext.connection;
        this.#networkManager = new NetworkManager(this.#connection, this);
        this.#onFrameAttached({
            ...info,
            url: info.url ?? 'about:blank',
            children: info.children ?? [],
        });
        for (const [event, subscriber] of this.#subscribedEvents) {
            this.#connection.on(event, subscriber);
        }
        for (const [event, subscriber] of this.#networkManagerEvents) {
            this.#networkManager.on(event, subscriber);
        }
        // TODO: https://github.com/w3c/webdriver-bidi/issues/443
        this.#accessibility = new index.Accessibility(this.mainFrame().context().cdpSession);
        this.#tracing = new index.Tracing(this.mainFrame().context().cdpSession);
        this.#coverage = new index.Coverage(this.mainFrame().context().cdpSession);
        this.#emulationManager = new index.EmulationManager(this.mainFrame().context().cdpSession);
        this.#mouse = new Mouse(this.mainFrame().context());
        this.#touchscreen = new Touchscreen(this.mainFrame().context());
        this.#keyboard = new Keyboard(this.mainFrame().context());
    }
    get accessibility() {
        return this.#accessibility;
    }
    get tracing() {
        return this.#tracing;
    }
    get coverage() {
        return this.#coverage;
    }
    get mouse() {
        return this.#mouse;
    }
    get touchscreen() {
        return this.#touchscreen;
    }
    get keyboard() {
        return this.#keyboard;
    }
    browser() {
        return this.#browserContext.browser();
    }
    browserContext() {
        return this.#browserContext;
    }
    mainFrame() {
        const mainFrame = this.#frameTree.getMainFrame();
        index.assert(mainFrame, 'Requesting main frame too early!');
        return mainFrame;
    }
    frames() {
        return Array.from(this.#frameTree.frames());
    }
    frame(frameId) {
        return this.#frameTree.getById(frameId ?? '') || null;
    }
    childFrames(frameId) {
        return this.#frameTree.childFrames(frameId);
    }
    #onFrameLoaded(info) {
        const frame = this.frame(info.context);
        if (frame && this.mainFrame() === frame) {
            this.emit("load" /* PageEmittedEvents.Load */);
        }
    }
    #onFrameDOMContentLoaded(info) {
        const frame = this.frame(info.context);
        if (frame && this.mainFrame() === frame) {
            this.emit("domcontentloaded" /* PageEmittedEvents.DOMContentLoaded */);
        }
    }
    #onFrameAttached(info) {
        if (!this.frame(info.context) &&
            (this.frame(info.parent ?? '') || !this.#frameTree.getMainFrame())) {
            const context = new BrowsingContext(this.#connection, this.#timeoutSettings, info);
            this.#connection.registerBrowsingContexts(context);
            const frame = new Frame(this, context, this.#timeoutSettings, info.parent);
            this.#frameTree.addFrame(frame);
            this.emit("frameattached" /* PageEmittedEvents.FrameAttached */, frame);
        }
    }
    async #onFrameNavigated(info) {
        const frameId = info.context;
        let frame = this.frame(frameId);
        // Detach all child frames first.
        if (frame) {
            frame = await this.#frameTree.waitForFrame(frameId);
            this.emit("framenavigated" /* PageEmittedEvents.FrameNavigated */, frame);
        }
    }
    #onFrameDetached(info) {
        const frame = this.frame(info.context);
        if (frame) {
            if (frame === this.mainFrame()) {
                this.emit("close" /* PageEmittedEvents.Close */);
            }
            this.#removeFramesRecursively(frame);
        }
    }
    #removeFramesRecursively(frame) {
        for (const child of frame.childFrames()) {
            this.#removeFramesRecursively(child);
        }
        frame.dispose();
        this.#networkManager.clearMapAfterFrameDispose(frame);
        this.#frameTree.removeFrame(frame);
        this.emit("framedetached" /* PageEmittedEvents.FrameDetached */, frame);
    }
    #onLogEntryAdded(event) {
        const frame = this.frame(event.source.context);
        if (!frame) {
            return;
        }
        if (isConsoleLogEntry(event)) {
            const args = event.args.map(arg => {
                return getBidiHandle(frame.context(), arg, frame);
            });
            const text = args
                .reduce((value, arg) => {
                const parsedValue = arg.isPrimitiveValue
                    ? BidiSerializer.deserialize(arg.remoteValue())
                    : arg.toString();
                return `${value} ${parsedValue}`;
            }, '')
                .slice(1);
            this.emit("console" /* PageEmittedEvents.Console */, new index.ConsoleMessage(event.method, text, args, getStackTraceLocations(event.stackTrace)));
        }
        else if (isJavaScriptLogEntry(event)) {
            let message = event.text ?? '';
            if (event.stackTrace) {
                for (const callFrame of event.stackTrace.callFrames) {
                    const location = callFrame.url +
                        ':' +
                        callFrame.lineNumber +
                        ':' +
                        callFrame.columnNumber;
                    const functionName = callFrame.functionName || '<anonymous>';
                    message += `\n    at ${functionName} (${location})`;
                }
            }
            const error = new Error(message);
            error.stack = ''; // Don't capture Puppeteer stacktrace.
            this.emit("pageerror" /* PageEmittedEvents.PageError */, error);
        }
        else {
            index.debugError(`Unhandled LogEntry with type "${event.type}", text "${event.text}" and level "${event.level}"`);
        }
    }
    getNavigationResponse(id) {
        return this.#networkManager.getNavigationResponse(id);
    }
    async close() {
        if (this.#closedDeferred.finished()) {
            return;
        }
        this.#closedDeferred.resolve(new index.TargetCloseError('Page closed!'));
        this.#networkManager.dispose();
        await this.#connection.send('browsingContext.close', {
            context: this.mainFrame()._id,
        });
        this.emit("close" /* PageEmittedEvents.Close */);
        this.removeAllListeners();
    }
    async evaluateHandle(pageFunction, ...args) {
        pageFunction = index.withSourcePuppeteerURLIfNone(this.evaluateHandle.name, pageFunction);
        return this.mainFrame().evaluateHandle(pageFunction, ...args);
    }
    async evaluate(pageFunction, ...args) {
        pageFunction = index.withSourcePuppeteerURLIfNone(this.evaluate.name, pageFunction);
        return this.mainFrame().evaluate(pageFunction, ...args);
    }
    async goto(url, options) {
        return this.mainFrame().goto(url, options);
    }
    async reload(options) {
        const [response] = await Promise.all([
            this.waitForResponse(response => {
                return (response.request().isNavigationRequest() &&
                    response.url() === this.url());
            }),
            this.mainFrame().context().reload(options),
        ]);
        return response;
    }
    url() {
        return this.mainFrame().url();
    }
    setDefaultNavigationTimeout(timeout) {
        this.#timeoutSettings.setDefaultNavigationTimeout(timeout);
    }
    setDefaultTimeout(timeout) {
        this.#timeoutSettings.setDefaultTimeout(timeout);
    }
    getDefaultTimeout() {
        return this.#timeoutSettings.timeout();
    }
    async setContent(html, options = {}) {
        await this.mainFrame().setContent(html, options);
    }
    async content() {
        return this.mainFrame().content();
    }
    isJavaScriptEnabled() {
        return this.#emulationManager.javascriptEnabled;
    }
    async setGeolocation(options) {
        return await this.#emulationManager.setGeolocation(options);
    }
    async setJavaScriptEnabled(enabled) {
        return await this.#emulationManager.setJavaScriptEnabled(enabled);
    }
    async emulateMediaType(type) {
        return await this.#emulationManager.emulateMediaType(type);
    }
    async emulateCPUThrottling(factor) {
        return await this.#emulationManager.emulateCPUThrottling(factor);
    }
    async emulateMediaFeatures(features) {
        return await this.#emulationManager.emulateMediaFeatures(features);
    }
    async emulateTimezone(timezoneId) {
        return await this.#emulationManager.emulateTimezone(timezoneId);
    }
    async emulateIdleState(overrides) {
        return await this.#emulationManager.emulateIdleState(overrides);
    }
    async emulateVisionDeficiency(type) {
        return await this.#emulationManager.emulateVisionDeficiency(type);
    }
    async setViewport(viewport) {
        await this.#emulationManager.emulateViewport(viewport);
        this.#viewport = viewport;
    }
    viewport() {
        return this.#viewport;
    }
    async pdf(options = {}) {
        const { path = undefined } = options;
        const { printBackground: background, margin, landscape, width, height, pageRanges, scale, preferCSSPageSize, timeout, } = this._getPDFOptions(options, 'cm');
        const { result } = await index.waitWithTimeout(this.#connection.send('browsingContext.print', {
            context: this.mainFrame()._id,
            background,
            margin,
            orientation: landscape ? 'landscape' : 'portrait',
            page: {
                width,
                height,
            },
            pageRanges: pageRanges.split(', '),
            scale,
            shrinkToFit: !preferCSSPageSize,
        }), 'browsingContext.print', timeout);
        const buffer = Buffer.from(result.data, 'base64');
        await this._maybeWriteBufferToFile(path, buffer);
        return buffer;
    }
    async createPDFStream(options) {
        const buffer = await this.pdf(options);
        try {
            const { Readable } = await import('stream');
            return Readable.from(buffer);
        }
        catch (error) {
            if (error instanceof TypeError) {
                throw new Error('Can only pass a file path in a Node-like environment.');
            }
            throw error;
        }
    }
    async screenshot(options = {}) {
        const { path = undefined, encoding, ...args } = options;
        if (Object.keys(args).length >= 1) {
            throw new Error('BiDi only supports "encoding" and "path" options');
        }
        const { result } = await this.#connection.send('browsingContext.captureScreenshot', {
            context: this.mainFrame()._id,
        });
        if (encoding === 'base64') {
            return result.data;
        }
        const buffer = Buffer.from(result.data, 'base64');
        await this._maybeWriteBufferToFile(path, buffer);
        return buffer;
    }
    waitForRequest(urlOrPredicate, options = {}) {
        const { timeout = this.#timeoutSettings.timeout() } = options;
        return index.waitForEvent(this.#networkManager, index.NetworkManagerEmittedEvents.Request, async (request) => {
            if (index.isString(urlOrPredicate)) {
                return urlOrPredicate === request.url();
            }
            if (typeof urlOrPredicate === 'function') {
                return !!(await urlOrPredicate(request));
            }
            return false;
        }, timeout, this.#closedDeferred.valueOrThrow());
    }
    waitForResponse(urlOrPredicate, options = {}) {
        const { timeout = this.#timeoutSettings.timeout() } = options;
        return index.waitForEvent(this.#networkManager, index.NetworkManagerEmittedEvents.Response, async (response) => {
            if (index.isString(urlOrPredicate)) {
                return urlOrPredicate === response.url();
            }
            if (typeof urlOrPredicate === 'function') {
                return !!(await urlOrPredicate(response));
            }
            return false;
        }, timeout, this.#closedDeferred.valueOrThrow());
    }
    async waitForNetworkIdle(options = {}) {
        const { idleTime = 500, timeout = this.#timeoutSettings.timeout() } = options;
        await this._waitForNetworkIdle(this.#networkManager, idleTime, timeout, this.#closedDeferred);
    }
    title() {
        return this.mainFrame().title();
    }
}
function isConsoleLogEntry(event) {
    return event.type === 'console';
}
function isJavaScriptLogEntry(event) {
    return event.type === 'javascript';
}
function getStackTraceLocations(stackTrace) {
    const stackTraceLocations = [];
    if (stackTrace) {
        for (const callFrame of stackTrace.callFrames) {
            stackTraceLocations.push({
                url: callFrame.url,
                lineNumber: callFrame.lineNumber,
                columnNumber: callFrame.columnNumber,
            });
        }
    }
    return stackTraceLocations;
}

/**
 * Copyright 2022 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @internal
 */
class BrowserContext extends index.BrowserContext {
    #browser;
    #connection;
    #defaultViewport;
    #pages = new Map();
    #onContextDestroyedBind = this.#onContextDestroyed.bind(this);
    #init = index.Deferred.create();
    #isDefault = false;
    constructor(browser, options) {
        super();
        this.#browser = browser;
        this.#connection = this.#browser.connection;
        this.#defaultViewport = options.defaultViewport;
        this.#connection.on('browsingContext.contextDestroyed', this.#onContextDestroyedBind);
        this.#isDefault = options.isDefault;
        this.#getTree().catch(debugError);
    }
    get connection() {
        return this.#connection;
    }
    async #getTree() {
        if (!this.#isDefault) {
            this.#init.resolve();
            return;
        }
        try {
            const { result } = await this.#connection.send('browsingContext.getTree', {});
            for (const context of result.contexts) {
                const page = new Page(this, context);
                this.#pages.set(context.context, page);
            }
            this.#init.resolve();
        }
        catch (err) {
            this.#init.reject(err);
        }
    }
    async #onContextDestroyed(event) {
        const page = this.#pages.get(event.context);
        await page?.close().catch(error => {
            debugError(error);
        });
        this.#pages.delete(event.context);
    }
    async newPage() {
        await this.#init.valueOrThrow();
        const { result } = await this.#connection.send('browsingContext.create', {
            type: 'tab',
        });
        const page = new Page(this, {
            context: result.context,
            children: [],
        });
        if (this.#defaultViewport) {
            try {
                await page.setViewport(this.#defaultViewport);
            }
            catch {
                // No support for setViewport in Firefox.
            }
        }
        this.#pages.set(result.context, page);
        return page;
    }
    async close() {
        await this.#init.valueOrThrow();
        if (this.#isDefault) {
            throw new Error('Default context cannot be closed!');
        }
        for (const page of this.#pages.values()) {
            await page?.close().catch(error => {
                debugError(error);
            });
        }
        this.#pages.clear();
    }
    browser() {
        return this.#browser;
    }
    async pages() {
        await this.#init.valueOrThrow();
        return [...this.#pages.values()];
    }
    isIncognito() {
        return false;
    }
}

/**
 * Copyright 2022 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @internal
 */
class Browser extends index.Browser {
    static subscribeModules = [
        'browsingContext',
        'network',
        'log',
    ];
    static subscribeCdpEvents = [
        // Coverage
        'cdp.Debugger.scriptParsed',
        'cdp.CSS.styleSheetAdded',
        'cdp.Runtime.executionContextsCleared',
        // Tracing
        'cdp.Tracing.tracingComplete',
    ];
    #browserName = '';
    #browserVersion = '';
    static async create(opts) {
        let browserName = '';
        let browserVersion = '';
        // TODO: await until the connection is established.
        try {
            const { result } = await opts.connection.send('session.new', {
                capabilities: {
                    alwaysMatch: {
                        acceptInsecureCerts: opts.ignoreHTTPSErrors,
                    },
                },
            });
            browserName = result.capabilities.browserName ?? '';
            browserVersion = result.capabilities.browserVersion ?? '';
        }
        catch (err) {
            // Chrome does not support session.new.
            debugError(err);
        }
        await opts.connection.send('session.subscribe', {
            events: browserName.toLocaleLowerCase().includes('firefox')
                ? Browser.subscribeModules
                : [...Browser.subscribeModules, ...Browser.subscribeCdpEvents],
        });
        return new Browser({
            ...opts,
            browserName,
            browserVersion,
        });
    }
    #process;
    #closeCallback;
    #connection;
    #defaultViewport;
    #defaultContext;
    constructor(opts) {
        super();
        this.#process = opts.process;
        this.#closeCallback = opts.closeCallback;
        this.#connection = opts.connection;
        this.#defaultViewport = opts.defaultViewport;
        this.#browserName = opts.browserName;
        this.#browserVersion = opts.browserVersion;
        this.#process?.once('close', () => {
            this.#connection.dispose();
            this.emit("disconnected" /* BrowserEmittedEvents.Disconnected */);
        });
        this.#defaultContext = new BrowserContext(this, {
            defaultViewport: this.#defaultViewport,
            isDefault: true,
        });
    }
    get connection() {
        return this.#connection;
    }
    wsEndpoint() {
        return this.#connection.url;
    }
    async close() {
        if (this.#connection.closed) {
            return;
        }
        // TODO: implement browser.close.
        // await this.#connection.send('browser.close', {});
        this.#connection.dispose();
        await this.#closeCallback?.call(null);
    }
    isConnected() {
        return !this.#connection.closed;
    }
    process() {
        return this.#process ?? null;
    }
    async createIncognitoBrowserContext(_options) {
        // TODO: implement incognito context https://github.com/w3c/webdriver-bidi/issues/289.
        return new BrowserContext(this, {
            defaultViewport: this.#defaultViewport,
            isDefault: false,
        });
    }
    async version() {
        return `${this.#browserName}/${this.#browserVersion}`;
    }
    /**
     * Returns an array of all open browser contexts. In a newly created browser, this will
     * return a single instance of {@link BrowserContext}.
     */
    browserContexts() {
        // TODO: implement incognito context https://github.com/w3c/webdriver-bidi/issues/289.
        return [this.#defaultContext];
    }
    /**
     * Returns the default browser context. The default browser context cannot be closed.
     */
    defaultBrowserContext() {
        return this.#defaultContext;
    }
    newPage() {
        return this.#defaultContext.newPage();
    }
}

/**
 * Copyright 2017 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const debugProtocolSend = index.debug('puppeteer:webDriverBiDi:SEND ►');
const debugProtocolReceive = index.debug('puppeteer:webDriverBiDi:RECV ◀');
/**
 * @internal
 */
class Connection extends index.EventEmitter {
    #url;
    #transport;
    #delay;
    #timeout = 0;
    #closed = false;
    #callbacks = new index.CallbackRegistry();
    #browsingContexts = new Map();
    constructor(url, transport, delay = 0, timeout) {
        super();
        this.#url = url;
        this.#delay = delay;
        this.#timeout = timeout ?? 180000;
        this.#transport = transport;
        this.#transport.onmessage = this.onMessage.bind(this);
        this.#transport.onclose = this.#onClose.bind(this);
    }
    get closed() {
        return this.#closed;
    }
    get url() {
        return this.#url;
    }
    send(method, params) {
        return this.#callbacks.create(method, this.#timeout, id => {
            const stringifiedMessage = JSON.stringify({
                id,
                method,
                params,
            });
            debugProtocolSend(stringifiedMessage);
            this.#transport.send(stringifiedMessage);
        });
    }
    /**
     * @internal
     */
    async onMessage(message) {
        if (this.#delay) {
            await new Promise(f => {
                return setTimeout(f, this.#delay);
            });
        }
        debugProtocolReceive(message);
        const object = JSON.parse(message);
        if ('id' in object) {
            if ('error' in object) {
                this.#callbacks.reject(object.id, createProtocolError(object), object.message);
            }
            else {
                this.#callbacks.resolve(object.id, object);
            }
        }
        else {
            this.#maybeEmitOnContext(object);
            this.emit(object.method, object.params);
        }
    }
    #maybeEmitOnContext(event) {
        let context;
        // Context specific events
        if ('context' in event.params && event.params.context) {
            context = this.#browsingContexts.get(event.params.context);
            // `log.entryAdded` specific context
        }
        else if ('source' in event.params && event.params.source.context) {
            context = this.#browsingContexts.get(event.params.source.context);
        }
        else if (isCDPEvent(event)) {
            // TODO: this is not a good solution and we need to find a better one.
            // Perhaps we need to have a dedicated CDP event emitter or emulate
            // the CDPSession interface with BiDi?.
            const cdpSessionId = event.params.session;
            for (const context of this.#browsingContexts.values()) {
                if (context.cdpSession?.id() === cdpSessionId) {
                    context.cdpSession.emit(event.params.event, event.params.params);
                }
            }
        }
        context?.emit(event.method, event.params);
    }
    registerBrowsingContexts(context) {
        this.#browsingContexts.set(context.id, context);
    }
    unregisterBrowsingContexts(id) {
        this.#browsingContexts.delete(id);
    }
    #onClose() {
        if (this.#closed) {
            return;
        }
        this.#closed = true;
        this.#transport.onmessage = undefined;
        this.#transport.onclose = undefined;
        this.#callbacks.clear();
    }
    dispose() {
        this.#onClose();
        this.#transport.close();
    }
}
/**
 * @internal
 */
function createProtocolError(object) {
    let message = `${object.error} ${object.message}`;
    if (object.stacktrace) {
        message += ` ${object.stacktrace}`;
    }
    return message;
}
function isCDPEvent(event) {
    return event.method.startsWith('cdp.');
}

var bidiMapper = {};

var BidiServer$1 = {};

var EventEmitter$1 = {};

var mitt=function(n){return {all:n=n||new Map,on:function(e,t){var i=n.get(e);i?i.push(t):n.set(e,[t]);},off:function(e,t){var i=n.get(e);i&&(t?i.splice(i.indexOf(t)>>>0,1):n.set(e,[]));},emit:function(e,t){var i=n.get(e);i&&i.slice().map(function(n){n(t);}),(i=n.get("*"))&&i.slice().map(function(n){n(e,t);});}}};

var __importDefault = (index.commonjsGlobal && index.commonjsGlobal.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(EventEmitter$1, "__esModule", { value: true });
EventEmitter$1.EventEmitter = void 0;
/**
 * Copyright 2022 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const mitt_1 = __importDefault(mitt);
class EventEmitter {
    #emitter = (0, mitt_1.default)();
    on(type, handler) {
        this.#emitter.on(type, handler);
        return this;
    }
    /**
     * Like `on` but the listener will only be fired once and then it will be removed.
     * @param event The event you'd like to listen to
     * @param handler The handler function to run when the event occurs
     * @return `this` to enable chaining method calls.
     */
    once(event, handler) {
        const onceHandler = (eventData) => {
            handler(eventData);
            this.off(event, onceHandler);
        };
        return this.on(event, onceHandler);
    }
    off(type, handler) {
        this.#emitter.off(type, handler);
        return this;
    }
    /**
     * Emits an event and call any associated listeners.
     *
     * @param event The event to emit.
     * @param eventData Any data to emit with the event.
     * @return `true` if there are any listeners, `false` otherwise.
     */
    emit(event, eventData) {
        this.#emitter.emit(event, eventData);
    }
}
EventEmitter$1.EventEmitter = EventEmitter;

var log = {};

(function (exports) {
	/**
	 * Copyright 2021 Google LLC.
	 * Copyright (c) Microsoft Corporation.
	 *
	 * Licensed under the Apache License, Version 2.0 (the "License");
	 * you may not use this file except in compliance with the License.
	 * You may obtain a copy of the License at
	 *
	 *     http://www.apache.org/licenses/LICENSE-2.0
	 *
	 * Unless required by applicable law or agreed to in writing, software
	 * distributed under the License is distributed on an "AS IS" BASIS,
	 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	 * See the License for the specific language governing permissions and
	 * limitations under the License.
	 */
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.LogType = void 0;
	(function (LogType) {
	    // keep-sorted start
	    LogType["bidi"] = "BiDi Messages";
	    LogType["browsingContexts"] = "Browsing Contexts";
	    LogType["cdp"] = "CDP";
	    LogType["system"] = "System";
	    // keep-sorted end
	})(exports.LogType || (exports.LogType = {}));
	
} (log));

var processingQueue = {};

/**
 * Copyright 2022 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(processingQueue, "__esModule", { value: true });
processingQueue.ProcessingQueue = void 0;
const log_js_1$5 = log;
class ProcessingQueue {
    #logger;
    #processor;
    #queue = [];
    // Flag to keep only 1 active processor.
    #isProcessing = false;
    constructor(processor, logger) {
        this.#processor = processor;
        this.#logger = logger;
    }
    add(entry) {
        this.#queue.push(entry);
        // No need in waiting. Just initialise processor if needed.
        void this.#processIfNeeded();
    }
    async #processIfNeeded() {
        if (this.#isProcessing) {
            return;
        }
        this.#isProcessing = true;
        while (this.#queue.length > 0) {
            const entryPromise = this.#queue.shift();
            if (entryPromise !== undefined) {
                await entryPromise
                    .then((entry) => this.#processor(entry))
                    .catch((e) => {
                    this.#logger?.(log_js_1$5.LogType.system, 'Event was not processed:', e);
                });
            }
        }
        this.#isProcessing = false;
    }
}
processingQueue.ProcessingQueue = ProcessingQueue;

var CommandProcessor$1 = {};

var browsingContextProcessor = {};

var InputStateManager$1 = {};

var assert$1 = {};

/**
 * Copyright 2023 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(assert$1, "__esModule", { value: true });
assert$1.assert = void 0;
function assert(predicate) {
    if (!predicate) {
        throw new Error('Internal assertion failed.');
    }
}
assert$1.assert = assert;

var InputState$1 = {};

var Mutex$1 = {};

/**
 * Copyright 2023 Google LLC.
 * Copyright (c) Microsoft Corporation.
 * Copyright 2022 The Chromium Authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(Mutex$1, "__esModule", { value: true });
Mutex$1.Mutex = void 0;
/**
 * Use Mutex class to coordinate local concurrent operations.
 * Once `acquire` promise resolves, you hold the lock and must
 * call `release` function returned by `acquire` to release the
 * lock. Failing to `release` the lock may lead to deadlocks.
 */
class Mutex {
    #locked = false;
    #acquirers = [];
    // This is FIFO.
    acquire() {
        const state = { resolved: false };
        if (this.#locked) {
            return new Promise((resolve) => {
                this.#acquirers.push(() => resolve(this.#release.bind(this, state)));
            });
        }
        this.#locked = true;
        return Promise.resolve(this.#release.bind(this, state));
    }
    #release(state) {
        if (state.resolved) {
            throw new Error('Cannot release more than once.');
        }
        state.resolved = true;
        const resolve = this.#acquirers.shift();
        if (!resolve) {
            this.#locked = false;
            return;
        }
        resolve();
    }
    async run(action) {
        const release = await this.acquire();
        try {
            // Note we need to await here because we want the await to release AFTER
            // that await happens. Returning action() will trigger the release
            // immediately which is counter to what we want.
            const result = await action();
            return result;
        }
        finally {
            release();
        }
    }
}
Mutex$1.Mutex = Mutex;

var InputSource = {};

(function (exports) {
	/**
	 * Copyright 2023 Google LLC.
	 * Copyright (c) Microsoft Corporation.
	 *
	 * Licensed under the Apache License, Version 2.0 (the "License");
	 * you may not use this file except in compliance with the License.
	 * You may obtain a copy of the License at
	 *
	 *     http://www.apache.org/licenses/LICENSE-2.0
	 *
	 * Unless required by applicable law or agreed to in writing, software
	 * distributed under the License is distributed on an "AS IS" BASIS,
	 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	 * See the License for the specific language governing permissions and
	 * limitations under the License.
	 */
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.WheelSource = exports.PointerSource = exports.KeySource = exports.NoneSource = exports.SourceType = void 0;
	const protocol_js_1 = protocol;
	exports.SourceType = protocol_js_1.Input.SourceActionsType;
	class NoneSource {
	    type = exports.SourceType.None;
	}
	exports.NoneSource = NoneSource;
	class KeySource {
	    type = exports.SourceType.Key;
	    pressed = new Set();
	    // This is a bitfield that matches the modifiers parameter of
	    // https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchKeyEvent
	    #modifiers = 0;
	    get modifiers() {
	        return this.#modifiers;
	    }
	    get alt() {
	        return (this.#modifiers & 1) === 1;
	    }
	    set alt(value) {
	        this.#setModifier(value, 1);
	    }
	    get ctrl() {
	        return (this.#modifiers & 2) === 2;
	    }
	    set ctrl(value) {
	        this.#setModifier(value, 2);
	    }
	    get meta() {
	        return (this.#modifiers & 4) === 4;
	    }
	    set meta(value) {
	        this.#setModifier(value, 4);
	    }
	    get shift() {
	        return (this.#modifiers & 8) === 8;
	    }
	    set shift(value) {
	        this.#setModifier(value, 8);
	    }
	    #setModifier(value, bit) {
	        if (value) {
	            this.#modifiers |= bit;
	        }
	        else {
	            this.#modifiers &= ~bit;
	        }
	    }
	}
	exports.KeySource = KeySource;
	class PointerSource {
	    type = exports.SourceType.Pointer;
	    subtype;
	    pointerId;
	    pressed = new Set();
	    x = 0;
	    y = 0;
	    constructor(id, subtype) {
	        this.pointerId = id;
	        this.subtype = subtype;
	    }
	    // This is a bitfield that matches the buttons parameter of
	    // https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchMouseEvent
	    get buttons() {
	        let buttons = 0;
	        for (const button of this.pressed) {
	            switch (button) {
	                case 0:
	                    buttons |= 1;
	                    break;
	                case 1:
	                    buttons |= 4;
	                    break;
	                case 2:
	                    buttons |= 2;
	                    break;
	                case 3:
	                    buttons |= 8;
	                    break;
	                case 4:
	                    buttons |= 16;
	                    break;
	            }
	        }
	        return buttons;
	    }
	    // --- Platform-specific state starts here ---
	    // Input.dispatchMouseEvent doesn't know the concept of double click, so we
	    // need to create it like for OSes:
	    // https://source.chromium.org/chromium/chromium/src/+/refs/heads/main:ui/events/event.cc;l=479
	    static #DOUBLE_CLICK_TIME_MS = 500;
	    static #MAX_DOUBLE_CLICK_RADIUS = 2;
	    #clickCount = 0;
	    #lastClick;
	    setClickCount(context) {
	        if (!this.#lastClick ||
	            // The click needs to be within a certain amount of ms.
	            context.timeStamp - this.#lastClick.timeStamp >
	                PointerSource.#DOUBLE_CLICK_TIME_MS ||
	            // The click needs to be within a square radius.
	            Math.abs(this.#lastClick.x - context.x) >
	                PointerSource.#MAX_DOUBLE_CLICK_RADIUS ||
	            Math.abs(this.#lastClick.y - context.y) >
	                PointerSource.#MAX_DOUBLE_CLICK_RADIUS) {
	            this.#clickCount = 0;
	        }
	        ++this.#clickCount;
	        this.#lastClick = context;
	    }
	    get clickCount() {
	        return this.#clickCount;
	    }
	}
	exports.PointerSource = PointerSource;
	class WheelSource {
	    type = exports.SourceType.Wheel;
	}
	exports.WheelSource = WheelSource;
	
} (InputSource));

/**
 * Copyright 2023 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(InputState$1, "__esModule", { value: true });
InputState$1.InputState = void 0;
const protocol_js_1$c = protocol;
const Mutex_js_1 = Mutex$1;
const InputSource_js_1 = InputSource;
class InputState {
    cancelList = [];
    #sources = new Map();
    #mutex = new Mutex_js_1.Mutex();
    getOrCreate(id, type, subtype) {
        let source = this.#sources.get(id);
        if (!source) {
            switch (type) {
                case InputSource_js_1.SourceType.None:
                    source = new InputSource_js_1.NoneSource();
                    break;
                case InputSource_js_1.SourceType.Key:
                    source = new InputSource_js_1.KeySource();
                    break;
                case InputSource_js_1.SourceType.Pointer: {
                    let pointerId = subtype === protocol_js_1$c.Input.PointerType.Mouse ? 0 : 2;
                    const pointerIds = new Set();
                    for (const [, source] of this.#sources) {
                        if (source.type === InputSource_js_1.SourceType.Pointer) {
                            pointerIds.add(source.pointerId);
                        }
                    }
                    while (pointerIds.has(pointerId)) {
                        ++pointerId;
                    }
                    source = new InputSource_js_1.PointerSource(pointerId, subtype);
                    break;
                }
                case InputSource_js_1.SourceType.Wheel:
                    source = new InputSource_js_1.WheelSource();
                    break;
                default:
                    throw new protocol_js_1$c.Message.InvalidArgumentException(`Expected "${InputSource_js_1.SourceType.None}", "${InputSource_js_1.SourceType.Key}", "${InputSource_js_1.SourceType.Pointer}", or "${InputSource_js_1.SourceType.Wheel}". Found unknown source type ${type}.`);
            }
            this.#sources.set(id, source);
            return source;
        }
        if (source.type !== type) {
            throw new protocol_js_1$c.Message.InvalidArgumentException(`Input source type of ${id} is ${source.type}, but received ${type}.`);
        }
        return source;
    }
    get(id) {
        const source = this.#sources.get(id);
        if (!source) {
            throw new protocol_js_1$c.Message.UnknownErrorException(`Internal error.`);
        }
        return source;
    }
    getGlobalKeyState() {
        const state = new InputSource_js_1.KeySource();
        for (const [, source] of this.#sources) {
            if (source.type !== InputSource_js_1.SourceType.Key) {
                continue;
            }
            for (const pressed of source.pressed) {
                state.pressed.add(pressed);
            }
            state.alt ||= source.alt;
            state.ctrl ||= source.ctrl;
            state.meta ||= source.meta;
            state.shift ||= source.shift;
        }
        return state;
    }
    get queue() {
        return this.#mutex;
    }
}
InputState$1.InputState = InputState;

/**
 * Copyright 2023 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(InputStateManager$1, "__esModule", { value: true });
InputStateManager$1.InputStateManager = void 0;
const assert_js_1$1 = assert$1;
const InputState_js_1 = InputState$1;
class InputStateManager {
    // We use a weak map here as specified here:
    // https://www.w3.org/TR/webdriver/#dfn-browsing-context-input-state-map
    #states = new WeakMap();
    get(context) {
        (0, assert_js_1$1.assert)(context.isTopLevelContext());
        let state = this.#states.get(context);
        if (!state) {
            state = new InputState_js_1.InputState();
            this.#states.set(context, state);
        }
        return state;
    }
    delete(context) {
        this.#states.delete(context);
    }
}
InputStateManager$1.InputStateManager = InputStateManager;

var ActionDispatcher$1 = {};

var USKeyboardLayout = {};

/**
 * Copyright 2023 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(USKeyboardLayout, "__esModule", { value: true });
USKeyboardLayout.KeyToKeyCode = void 0;
// TODO: Remove this once https://crrev.com/c/4548290 is stably in Chromium.
// `Input.dispatchKeyboardEvent` will automatically handle these conversions.
USKeyboardLayout.KeyToKeyCode = {
    '0': 48,
    '1': 49,
    '2': 50,
    '3': 51,
    '4': 52,
    '5': 53,
    '6': 54,
    '7': 55,
    '8': 56,
    '9': 57,
    Abort: 3,
    Help: 6,
    Backspace: 8,
    Tab: 9,
    Numpad5: 12,
    NumpadEnter: 13,
    Enter: 13,
    '\\r': 13,
    '\\n': 13,
    ShiftLeft: 16,
    ShiftRight: 16,
    ControlLeft: 17,
    ControlRight: 17,
    AltLeft: 18,
    AltRight: 18,
    Pause: 19,
    CapsLock: 20,
    Escape: 27,
    Convert: 28,
    NonConvert: 29,
    Space: 32,
    Numpad9: 33,
    PageUp: 33,
    Numpad3: 34,
    PageDown: 34,
    End: 35,
    Numpad1: 35,
    Home: 36,
    Numpad7: 36,
    ArrowLeft: 37,
    Numpad4: 37,
    Numpad8: 38,
    ArrowUp: 38,
    ArrowRight: 39,
    Numpad6: 39,
    Numpad2: 40,
    ArrowDown: 40,
    Select: 41,
    Open: 43,
    PrintScreen: 44,
    Insert: 45,
    Numpad0: 45,
    Delete: 46,
    NumpadDecimal: 46,
    Digit0: 48,
    Digit1: 49,
    Digit2: 50,
    Digit3: 51,
    Digit4: 52,
    Digit5: 53,
    Digit6: 54,
    Digit7: 55,
    Digit8: 56,
    Digit9: 57,
    KeyA: 65,
    KeyB: 66,
    KeyC: 67,
    KeyD: 68,
    KeyE: 69,
    KeyF: 70,
    KeyG: 71,
    KeyH: 72,
    KeyI: 73,
    KeyJ: 74,
    KeyK: 75,
    KeyL: 76,
    KeyM: 77,
    KeyN: 78,
    KeyO: 79,
    KeyP: 80,
    KeyQ: 81,
    KeyR: 82,
    KeyS: 83,
    KeyT: 84,
    KeyU: 85,
    KeyV: 86,
    KeyW: 87,
    KeyX: 88,
    KeyY: 89,
    KeyZ: 90,
    MetaLeft: 91,
    MetaRight: 92,
    ContextMenu: 93,
    NumpadMultiply: 106,
    NumpadAdd: 107,
    NumpadSubtract: 109,
    NumpadDivide: 111,
    F1: 112,
    F2: 113,
    F3: 114,
    F4: 115,
    F5: 116,
    F6: 117,
    F7: 118,
    F8: 119,
    F9: 120,
    F10: 121,
    F11: 122,
    F12: 123,
    F13: 124,
    F14: 125,
    F15: 126,
    F16: 127,
    F17: 128,
    F18: 129,
    F19: 130,
    F20: 131,
    F21: 132,
    F22: 133,
    F23: 134,
    F24: 135,
    NumLock: 144,
    ScrollLock: 145,
    AudioVolumeMute: 173,
    AudioVolumeDown: 174,
    AudioVolumeUp: 175,
    MediaTrackNext: 176,
    MediaTrackPrevious: 177,
    MediaStop: 178,
    MediaPlayPause: 179,
    Semicolon: 186,
    Equal: 187,
    NumpadEqual: 187,
    Comma: 188,
    Minus: 189,
    Period: 190,
    Slash: 191,
    Backquote: 192,
    BracketLeft: 219,
    Backslash: 220,
    BracketRight: 221,
    Quote: 222,
    AltGraph: 225,
    Props: 247,
    Cancel: 3,
    Clear: 12,
    Shift: 16,
    Control: 17,
    Alt: 18,
    Accept: 30,
    ModeChange: 31,
    ' ': 32,
    Print: 42,
    Execute: 43,
    '\\u0000': 46,
    a: 65,
    b: 66,
    c: 67,
    d: 68,
    e: 69,
    f: 70,
    g: 71,
    h: 72,
    i: 73,
    j: 74,
    k: 75,
    l: 76,
    m: 77,
    n: 78,
    o: 79,
    p: 80,
    q: 81,
    r: 82,
    s: 83,
    t: 84,
    u: 85,
    v: 86,
    w: 87,
    x: 88,
    y: 89,
    z: 90,
    Meta: 91,
    '*': 106,
    '+': 107,
    '-': 109,
    '/': 111,
    ';': 186,
    '=': 187,
    ',': 188,
    '.': 190,
    '`': 192,
    '[': 219,
    '\\\\': 220,
    ']': 221,
    "'": 222,
    Attn: 246,
    CrSel: 247,
    ExSel: 248,
    EraseEof: 249,
    Play: 250,
    ZoomOut: 251,
    ')': 48,
    '!': 49,
    '@': 50,
    '#': 51,
    $: 52,
    '%': 53,
    '^': 54,
    '&': 55,
    '(': 57,
    A: 65,
    B: 66,
    C: 67,
    D: 68,
    E: 69,
    F: 70,
    G: 71,
    H: 72,
    I: 73,
    J: 74,
    K: 75,
    L: 76,
    M: 77,
    N: 78,
    O: 79,
    P: 80,
    Q: 81,
    R: 82,
    S: 83,
    T: 84,
    U: 85,
    V: 86,
    W: 87,
    X: 88,
    Y: 89,
    Z: 90,
    ':': 186,
    '<': 188,
    _: 189,
    '>': 190,
    '?': 191,
    '~': 192,
    '{': 219,
    '|': 220,
    '}': 221,
    '"': 222,
    Camera: 44,
    EndCall: 95,
    VolumeDown: 182,
    VolumeUp: 183,
};

var keyUtils = {};

/**
 * Copyright 2023 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(keyUtils, "__esModule", { value: true });
keyUtils.getKeyLocation = keyUtils.getKeyCode = keyUtils.getNormalizedKey = void 0;
function getNormalizedKey(value) {
    switch (value) {
        case '\uE000':
            return 'Unidentified';
        case '\uE001':
            return 'Cancel';
        case '\uE002':
            return 'Help';
        case '\uE003':
            return 'Backspace';
        case '\uE004':
            return 'Tab';
        case '\uE005':
            return 'Clear';
        case '\uE006':
            return 'Return';
        case '\uE007':
            return 'Enter';
        case '\uE008':
            return 'Shift';
        case '\uE009':
            return 'Control';
        case '\uE00A':
            return 'Alt';
        case '\uE00B':
            return 'Pause';
        case '\uE00C':
            return 'Escape';
        case '\uE00D':
            return ' ';
        case '\uE00E':
            return 'PageUp';
        case '\uE00F':
            return 'PageDown';
        case '\uE010':
            return 'End';
        case '\uE011':
            return 'Home';
        case '\uE012':
            return 'ArrowLeft';
        case '\uE013':
            return 'ArrowUp';
        case '\uE014':
            return 'ArrowRight';
        case '\uE015':
            return 'ArrowDown';
        case '\uE016':
            return 'Insert';
        case '\uE017':
            return 'Delete';
        case '\uE018':
            return ';';
        case '\uE019':
            return '=';
        case '\uE01A':
            return '0';
        case '\uE01B':
            return '1';
        case '\uE01C':
            return '2';
        case '\uE01D':
            return '3';
        case '\uE01E':
            return '4';
        case '\uE01F':
            return '5';
        case '\uE020':
            return '6';
        case '\uE021':
            return '7';
        case '\uE022':
            return '8';
        case '\uE023':
            return '9';
        case '\uE024':
            return '*';
        case '\uE025':
            return '+';
        case '\uE026':
            return ',';
        case '\uE027':
            return '-';
        case '\uE028':
            return '.';
        case '\uE029':
            return '/';
        case '\uE031':
            return 'F1';
        case '\uE032':
            return 'F2';
        case '\uE033':
            return 'F3';
        case '\uE034':
            return 'F4';
        case '\uE035':
            return 'F5';
        case '\uE036':
            return 'F6';
        case '\uE037':
            return 'F7';
        case '\uE038':
            return 'F8';
        case '\uE039':
            return 'F9';
        case '\uE03A':
            return 'F10';
        case '\uE03B':
            return 'F11';
        case '\uE03C':
            return 'F12';
        case '\uE03D':
            return 'Meta';
        case '\uE040':
            return 'ZenkakuHankaku';
        case '\uE050':
            return 'Shift';
        case '\uE051':
            return 'Control';
        case '\uE052':
            return 'Alt';
        case '\uE053':
            return 'Meta';
        case '\uE054':
            return 'PageUp';
        case '\uE055':
            return 'PageDown';
        case '\uE056':
            return 'End';
        case '\uE057':
            return 'Home';
        case '\uE058':
            return 'ArrowLeft';
        case '\uE059':
            return 'ArrowUp';
        case '\uE05A':
            return 'ArrowRight';
        case '\uE05B':
            return 'ArrowDown';
        case '\uE05C':
            return 'Insert';
        case '\uE05D':
            return 'Delete';
        default:
            return value;
    }
}
keyUtils.getNormalizedKey = getNormalizedKey;
function getKeyCode(key) {
    switch (key) {
        case '`':
        case '~':
            return 'Backquote';
        case '\\':
        case '|':
            return 'Backslash';
        case '\uE003':
            return 'Backspace';
        case '[':
        case '{':
            return 'BracketLeft';
        case ']':
        case '}':
            return 'BracketRight';
        case ',':
        case '<':
            return 'Comma';
        case '0':
        case ')':
            return 'Digit0';
        case '1':
        case '!':
            return 'Digit1';
        case '2':
        case '@':
            return 'Digit2';
        case '3':
        case '#':
            return 'Digit3';
        case '4':
        case '$':
            return 'Digit4';
        case '5':
        case '%':
            return 'Digit5';
        case '6':
        case '^':
            return 'Digit6';
        case '7':
        case '&':
            return 'Digit7';
        case '8':
        case '*':
            return 'Digit8';
        case '9':
        case '(':
            return 'Digit9';
        case '=':
        case '+':
            return 'Equal';
        case 'a':
        case 'A':
            return 'KeyA';
        case 'b':
        case 'B':
            return 'KeyB';
        case 'c':
        case 'C':
            return 'KeyC';
        case 'd':
        case 'D':
            return 'KeyD';
        case 'e':
        case 'E':
            return 'KeyE';
        case 'f':
        case 'F':
            return 'KeyF';
        case 'g':
        case 'G':
            return 'KeyG';
        case 'h':
        case 'H':
            return 'KeyH';
        case 'i':
        case 'I':
            return 'KeyI';
        case 'j':
        case 'J':
            return 'KeyJ';
        case 'k':
        case 'K':
            return 'KeyK';
        case 'l':
        case 'L':
            return 'KeyL';
        case 'm':
        case 'M':
            return 'KeyM';
        case 'n':
        case 'N':
            return 'KeyN';
        case 'o':
        case 'O':
            return 'KeyO';
        case 'p':
        case 'P':
            return 'KeyP';
        case 'q':
        case 'Q':
            return 'KeyQ';
        case 'r':
        case 'R':
            return 'KeyR';
        case 's':
        case 'S':
            return 'KeyS';
        case 't':
        case 'T':
            return 'KeyT';
        case 'u':
        case 'U':
            return 'KeyU';
        case 'v':
        case 'V':
            return 'KeyV';
        case 'w':
        case 'W':
            return 'KeyW';
        case 'x':
        case 'X':
            return 'KeyX';
        case 'y':
        case 'Y':
            return 'KeyY';
        case 'z':
        case 'Z':
            return 'KeyZ';
        case '-':
        case '_':
            return 'Minus';
        case '.':
            return 'Period';
        case "'":
        case '"':
            return 'Quote';
        case ';':
        case ':':
            return 'Semicolon';
        case '/':
        case '?':
            return 'Slash';
        case '\uE00A':
            return 'AltLeft';
        case '\uE052':
            return 'AltRight';
        case '\uE009':
            return 'ControlLeft';
        case '\uE051':
            return 'ControlRight';
        case '\uE006':
            return 'Enter';
        case '\uE03D':
            return 'MetaLeft';
        case '\uE053':
            return 'MetaRight';
        case '\uE008':
            return 'ShiftLeft';
        case '\uE050':
            return 'ShiftRight';
        case ' ':
        case '\uE00D':
            return 'Space';
        case '\uE004':
            return 'Tab';
        case '\uE017':
            return 'Delete';
        case '\uE010':
            return 'End';
        case '\uE002':
            return 'Help';
        case '\uE011':
            return 'Home';
        case '\uE016':
            return 'Insert';
        case '\uE00F':
            return 'PageDown';
        case '\uE00E':
            return 'PageUp';
        case '\uE015':
            return 'ArrowDown';
        case '\uE012':
            return 'ArrowLeft';
        case '\uE014':
            return 'ArrowRight';
        case '\uE013':
            return 'ArrowUp';
        case '\uE00C':
            return 'Escape';
        case '\uE031':
            return 'F1';
        case '\uE032':
            return 'F2';
        case '\uE033':
            return 'F3';
        case '\uE034':
            return 'F4';
        case '\uE035':
            return 'F5';
        case '\uE036':
            return 'F6';
        case '\uE037':
            return 'F7';
        case '\uE038':
            return 'F8';
        case '\uE039':
            return 'F9';
        case '\uE03A':
            return 'F10';
        case '\uE03B':
            return 'F11';
        case '\uE03C':
            return 'F12';
        case '\uE01A':
        case '\uE05C':
            return 'Numpad0';
        case '\uE01B':
        case '\uE056':
            return 'Numpad1';
        case '\uE01C':
        case '\uE05B':
            return 'Numpad2';
        case '\uE01D':
        case '\uE055':
            return 'Numpad3';
        case '\uE01E':
        case '\uE058':
            return 'Numpad4';
        case '\uE01F':
            return 'Numpad5';
        case '\uE020':
        case '\uE05A':
            return 'Numpad6';
        case '\uE021':
        case '\uE057':
            return 'Numpad7';
        case '\uE022':
        case '\uE059':
            return 'Numpad8';
        case '\uE023':
        case '\uE054':
            return 'Numpad9';
        case '\uE025':
            return 'NumpadAdd';
        case '\uE026':
            return 'NumpadComma';
        case '\uE028':
        case '\uE05D':
            return 'NumpadDecimal';
        case '\uE029':
            return 'NumpadDivide';
        case '\uE007':
            return 'NumpadEnter';
        case '\uE024':
            return 'NumpadMultiply';
        case '\uE027':
            return 'NumpadSubtract';
        default:
            return;
    }
}
keyUtils.getKeyCode = getKeyCode;
function getKeyLocation(key) {
    switch (key) {
        case '\uE007':
        case '\uE008':
        case '\uE009':
        case '\uE00A':
        case '\uE03D':
            return 1;
        case '\uE01A':
        case '\uE01B':
        case '\uE01C':
        case '\uE01D':
        case '\uE01E':
        case '\uE01F':
        case '\uE020':
        case '\uE021':
        case '\uE022':
        case '\uE023':
        case '\uE024':
        case '\uE025':
        case '\uE026':
        case '\uE027':
        case '\uE028':
        case '\uE029':
        case '\uE054':
        case '\uE055':
        case '\uE056':
        case '\uE057':
        case '\uE058':
        case '\uE059':
        case '\uE05A':
        case '\uE05B':
        case '\uE05C':
        case '\uE05D':
            return 3;
        case '\uE050':
        case '\uE051':
        case '\uE052':
        case '\uE053':
            return 2;
        default:
            return 0;
    }
}
keyUtils.getKeyLocation = getKeyLocation;

/**
 * Copyright 2023 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(ActionDispatcher$1, "__esModule", { value: true });
ActionDispatcher$1.ActionDispatcher = void 0;
const protocol_js_1$b = protocol;
const assert_js_1 = assert$1;
const USKeyboardLayout_js_1 = USKeyboardLayout;
const keyUtils_js_1 = keyUtils;
/** https://w3c.github.io/webdriver/#dfn-center-point */
const CALCULATE_IN_VIEW_CENTER_PT_DECL = ((i) => {
    const t = i.getClientRects()[0], e = Math.max(0, Math.min(t.x, t.x + t.width)), n = Math.min(window.innerWidth, Math.max(t.x, t.x + t.width)), h = Math.max(0, Math.min(t.y, t.y + t.height)), m = Math.min(window.innerHeight, Math.max(t.y, t.y + t.height));
    return [e + ((n - e) >> 1), h + ((m - h) >> 1)];
}).toString();
const IS_MAC_DECL = (() => {
    return navigator.platform.toLowerCase().includes('mac');
}).toString();
async function getElementCenter(context, element) {
    const { result } = await (await context.getOrCreateSandbox(undefined)).callFunction(CALCULATE_IN_VIEW_CENTER_PT_DECL, { type: 'undefined' }, [element], false, 'none', {});
    if (result.type === 'exception') {
        throw new protocol_js_1$b.Message.NoSuchElementException(`Origin element ${element.sharedId} was not found`);
    }
    (0, assert_js_1.assert)(result.result.type === 'array');
    (0, assert_js_1.assert)(result.result.value?.[0]?.type === 'number');
    (0, assert_js_1.assert)(result.result.value?.[1]?.type === 'number');
    const { result: { value: [{ value: x }, { value: y }], }, } = result;
    return { x: x, y: y };
}
class ActionDispatcher {
    static isMacOS = async (context) => {
        const { result } = await (await context.getOrCreateSandbox(undefined)).callFunction(IS_MAC_DECL, { type: 'undefined' }, [], false, 'none', {});
        (0, assert_js_1.assert)(result.type !== 'exception');
        (0, assert_js_1.assert)(result.result.type === 'boolean');
        return result.result.value;
    };
    #tickStart = 0;
    #tickDuration = 0;
    #inputState;
    #context;
    #isMacOS;
    constructor(inputState, context, isMacOS) {
        this.#inputState = inputState;
        this.#context = context;
        this.#isMacOS = isMacOS;
    }
    async dispatchActions(optionsByTick) {
        await this.#inputState.queue.run(async () => {
            for (const options of optionsByTick) {
                await this.dispatchTickActions(options);
            }
        });
    }
    async dispatchTickActions(options) {
        this.#tickStart = performance.now();
        this.#tickDuration = 0;
        for (const { action } of options) {
            if ('duration' in action && action.duration !== undefined) {
                this.#tickDuration = Math.max(this.#tickDuration, action.duration);
            }
        }
        const promises = [
            new Promise((resolve) => setTimeout(resolve, this.#tickDuration)),
        ];
        for (const option of options) {
            promises.push(this.#dispatchAction(option));
        }
        await Promise.all(promises);
    }
    async #dispatchAction({ id, action }) {
        const source = this.#inputState.get(id);
        const keyState = this.#inputState.getGlobalKeyState();
        switch (action.type) {
            case protocol_js_1$b.Input.ActionType.KeyDown: {
                // SAFETY: The source is validated before.
                await this.#dispatchKeyDownAction(source, action);
                this.#inputState.cancelList.push({
                    id,
                    action: {
                        ...action,
                        type: protocol_js_1$b.Input.ActionType.KeyUp,
                    },
                });
                break;
            }
            case protocol_js_1$b.Input.ActionType.KeyUp: {
                // SAFETY: The source is validated before.
                await this.#dispatchKeyUpAction(source, action);
                break;
            }
            case protocol_js_1$b.Input.ActionType.Pause: {
                // TODO: Implement waiting on the input source.
                break;
            }
            case protocol_js_1$b.Input.ActionType.PointerDown: {
                // SAFETY: The source is validated before.
                await this.#dispatchPointerDownAction(source, keyState, action);
                this.#inputState.cancelList.push({
                    id,
                    action: {
                        ...action,
                        type: protocol_js_1$b.Input.ActionType.PointerUp,
                    },
                });
                break;
            }
            case protocol_js_1$b.Input.ActionType.PointerMove: {
                // SAFETY: The source is validated before.
                await this.#dispatchPointerMoveAction(source, keyState, action);
                break;
            }
            case protocol_js_1$b.Input.ActionType.PointerUp: {
                // SAFETY: The source is validated before.
                await this.#dispatchPointerUpAction(source, keyState, action);
                break;
            }
            case protocol_js_1$b.Input.ActionType.Scroll: {
                // SAFETY: The source is validated before.
                await this.#dispatchScrollAction(source, keyState, action);
                break;
            }
        }
    }
    #dispatchPointerDownAction(source, keyState, action) {
        const { button } = action;
        if (source.pressed.has(button)) {
            return;
        }
        source.pressed.add(button);
        const { x, y, subtype: pointerType } = source;
        const { width, height, pressure, twist, tangentialPressure } = action;
        const { tiltX, tiltY } = 'tiltX' in action ? action : {};
        // TODO: Implement azimuth/altitude angle.
        // --- Platform-specific code begins here ---
        const { modifiers } = keyState;
        switch (pointerType) {
            case protocol_js_1$b.Input.PointerType.Mouse:
            case protocol_js_1$b.Input.PointerType.Pen:
                source.setClickCount({ x, y, timeStamp: performance.now() });
                // TODO: Implement width and height when available.
                return this.#context.cdpTarget.cdpClient.sendCommand('Input.dispatchMouseEvent', {
                    type: 'mousePressed',
                    x,
                    y,
                    modifiers,
                    button: (() => {
                        switch (button) {
                            case 0:
                                return 'left';
                            case 1:
                                return 'middle';
                            case 2:
                                return 'right';
                            case 3:
                                return 'back';
                            case 4:
                                return 'forward';
                            default:
                                return 'none';
                        }
                    })(),
                    buttons: source.buttons,
                    clickCount: source.clickCount,
                    pointerType,
                    tangentialPressure,
                    tiltX,
                    tiltY,
                    twist,
                    force: pressure,
                });
            case protocol_js_1$b.Input.PointerType.Touch:
                return this.#context.cdpTarget.cdpClient.sendCommand('Input.dispatchTouchEvent', {
                    type: 'touchStart',
                    touchPoints: [
                        {
                            x,
                            y,
                            radiusX: width,
                            radiusY: height,
                            tangentialPressure,
                            tiltX,
                            tiltY,
                            twist,
                            force: pressure,
                            id: source.pointerId,
                        },
                    ],
                    modifiers,
                });
        }
        // --- Platform-specific code ends here ---
    }
    #dispatchPointerUpAction(source, keyState, action) {
        const { button } = action;
        if (!source.pressed.has(button)) {
            return;
        }
        source.pressed.delete(button);
        const { x, y, subtype: pointerType } = source;
        // --- Platform-specific code begins here ---
        const { modifiers } = keyState;
        switch (pointerType) {
            case protocol_js_1$b.Input.PointerType.Mouse:
            case protocol_js_1$b.Input.PointerType.Pen:
                // TODO: Implement width and height when available.
                return this.#context.cdpTarget.cdpClient.sendCommand('Input.dispatchMouseEvent', {
                    type: 'mouseReleased',
                    x,
                    y,
                    modifiers,
                    button: (() => {
                        switch (button) {
                            case 0:
                                return 'left';
                            case 1:
                                return 'middle';
                            case 2:
                                return 'right';
                            case 3:
                                return 'back';
                            case 4:
                                return 'forward';
                            default:
                                return 'none';
                        }
                    })(),
                    buttons: source.buttons,
                    clickCount: source.clickCount,
                    pointerType,
                });
            case protocol_js_1$b.Input.PointerType.Touch:
                return this.#context.cdpTarget.cdpClient.sendCommand('Input.dispatchTouchEvent', {
                    type: 'touchEnd',
                    touchPoints: [
                        {
                            x,
                            y,
                            id: source.pointerId,
                        },
                    ],
                    modifiers,
                });
        }
        // --- Platform-specific code ends here ---
    }
    async #dispatchPointerMoveAction(source, keyState, action) {
        const { x: startX, y: startY, subtype: pointerType } = source;
        const { width, height, pressure, twist, tangentialPressure, x: offsetX, y: offsetY, origin = 'viewport', duration = this.#tickDuration, } = action;
        const { tiltX, tiltY } = 'tiltX' in action ? action : {};
        // TODO: Implement azimuth/altitude angle.
        const { targetX, targetY } = await this.#getCoordinateFromOrigin(origin, offsetX, offsetY, startX, startY);
        if (targetX < 0 || targetY < 0) {
            throw new protocol_js_1$b.Message.MoveTargetOutOfBoundsException(`Cannot move beyond viewport (x: ${targetX}, y: ${targetY})`);
        }
        let last;
        do {
            const ratio = duration > 0 ? (performance.now() - this.#tickStart) / duration : 1;
            last = ratio >= 1;
            let x;
            let y;
            if (last) {
                x = targetX;
                y = targetY;
            }
            else {
                x = Math.round(ratio * (targetX - startX) + startX);
                y = Math.round(ratio * (targetY - startY) + startY);
            }
            if (source.x !== x || source.y !== y) {
                // --- Platform-specific code begins here ---
                const { modifiers } = keyState;
                switch (pointerType) {
                    case protocol_js_1$b.Input.PointerType.Mouse:
                    case protocol_js_1$b.Input.PointerType.Pen:
                        // TODO: Implement width and height when available.
                        await this.#context.cdpTarget.cdpClient.sendCommand('Input.dispatchMouseEvent', {
                            type: 'mouseMoved',
                            x,
                            y,
                            modifiers,
                            clickCount: 0,
                            buttons: source.buttons,
                            pointerType,
                            tangentialPressure,
                            tiltX,
                            tiltY,
                            twist,
                            force: pressure,
                        });
                        break;
                    case protocol_js_1$b.Input.PointerType.Touch:
                        await this.#context.cdpTarget.cdpClient.sendCommand('Input.dispatchTouchEvent', {
                            type: 'touchMove',
                            touchPoints: [
                                {
                                    x,
                                    y,
                                    radiusX: width,
                                    radiusY: height,
                                    tangentialPressure,
                                    tiltX,
                                    tiltY,
                                    twist,
                                    force: pressure,
                                    id: source.pointerId,
                                },
                            ],
                            modifiers,
                        });
                        break;
                }
                // --- Platform-specific code ends here ---
                source.x = x;
                source.y = y;
            }
        } while (!last);
    }
    async #getCoordinateFromOrigin(origin, offsetX, offsetY, startX, startY) {
        let targetX;
        let targetY;
        switch (origin) {
            case 'viewport':
                targetX = offsetX;
                targetY = offsetY;
                break;
            case 'pointer':
                targetX = startX + offsetX;
                targetY = startY + offsetY;
                break;
            default: {
                const { x: posX, y: posY } = await getElementCenter(this.#context, origin.element);
                // SAFETY: These can never be special numbers.
                targetX = posX + offsetX;
                targetY = posY + offsetY;
                break;
            }
        }
        return { targetX, targetY };
    }
    async #dispatchScrollAction(_source, keyState, action) {
        const { deltaX: targetDeltaX, deltaY: targetDeltaY, x: offsetX, y: offsetY, origin = 'viewport', duration = this.#tickDuration, } = action;
        if (origin === 'pointer') {
            throw new protocol_js_1$b.Message.InvalidArgumentException('"pointer" origin is invalid for scrolling.');
        }
        const { targetX, targetY } = await this.#getCoordinateFromOrigin(origin, offsetX, offsetY, 0, 0);
        if (targetX < 0 || targetY < 0) {
            throw new protocol_js_1$b.Message.MoveTargetOutOfBoundsException(`Cannot move beyond viewport (x: ${targetX}, y: ${targetY})`);
        }
        let currentDeltaX = 0;
        let currentDeltaY = 0;
        let last;
        do {
            const ratio = duration > 0 ? (performance.now() - this.#tickStart) / duration : 1;
            last = ratio >= 1;
            let deltaX;
            let deltaY;
            if (last) {
                deltaX = targetDeltaX - currentDeltaX;
                deltaY = targetDeltaY - currentDeltaY;
            }
            else {
                deltaX = Math.round(ratio * targetDeltaX - currentDeltaX);
                deltaY = Math.round(ratio * targetDeltaY - currentDeltaY);
            }
            if (deltaX !== 0 || deltaY !== 0) {
                // --- Platform-specific code begins here ---
                const { modifiers } = keyState;
                await this.#context.cdpTarget.cdpClient.sendCommand('Input.dispatchMouseEvent', {
                    type: 'mouseWheel',
                    deltaX,
                    deltaY,
                    x: targetX,
                    y: targetY,
                    modifiers,
                });
                // --- Platform-specific code ends here ---
                currentDeltaX += deltaX;
                currentDeltaY += deltaY;
            }
        } while (!last);
    }
    #dispatchKeyDownAction(source, action) {
        const rawKey = action.value;
        const key = (0, keyUtils_js_1.getNormalizedKey)(rawKey);
        const repeat = source.pressed.has(key);
        const code = (0, keyUtils_js_1.getKeyCode)(rawKey);
        const location = (0, keyUtils_js_1.getKeyLocation)(rawKey);
        switch (key) {
            case 'Alt':
                source.alt = true;
                break;
            case 'Shift':
                source.shift = true;
                break;
            case 'Control':
                source.ctrl = true;
                break;
            case 'Meta':
                source.meta = true;
                break;
        }
        source.pressed.add(key);
        const { modifiers } = source;
        // --- Platform-specific code begins here ---
        // The spread is a little hack so JS gives us an array of unicode characters
        // to measure.
        const unmodifiedText = getKeyEventUnmodifiedText(key, source);
        const text = getKeyEventText(code ?? '', source) ?? unmodifiedText;
        let command;
        // The following commands need to be declared because Chromium doesn't
        // handle them. See
        // https://source.chromium.org/chromium/chromium/src/+/refs/heads/main:third_party/blink/renderer/core/editing/editing_behavior.cc;l=169;drc=b8143cf1dfd24842890fcd831c4f5d909bef4fc4;bpv=0;bpt=1.
        if (this.#isMacOS && source.meta) {
            switch (code) {
                case 'KeyA':
                    command = 'SelectAll';
                    break;
                case 'KeyC':
                    command = 'Copy';
                    break;
                case 'KeyV':
                    command = source.shift ? 'PasteAndMatchStyle' : 'Paste';
                    break;
                case 'KeyX':
                    command = 'Cut';
                    break;
                case 'KeyZ':
                    command = source.shift ? 'Redo' : 'Undo';
                    break;
            }
        }
        return this.#context.cdpTarget.cdpClient.sendCommand('Input.dispatchKeyEvent', {
            type: text ? 'keyDown' : 'rawKeyDown',
            windowsVirtualKeyCode: USKeyboardLayout_js_1.KeyToKeyCode[key],
            key,
            code,
            text,
            unmodifiedText,
            autoRepeat: repeat,
            isSystemKey: source.alt || undefined,
            location: location < 3 ? location : undefined,
            isKeypad: location === 3,
            modifiers,
            commands: command ? [command] : undefined,
        });
        // --- Platform-specific code ends here ---
    }
    #dispatchKeyUpAction(source, action) {
        const rawKey = action.value;
        const key = (0, keyUtils_js_1.getNormalizedKey)(rawKey);
        if (!source.pressed.has(key)) {
            return;
        }
        const code = (0, keyUtils_js_1.getKeyCode)(rawKey);
        const location = (0, keyUtils_js_1.getKeyLocation)(rawKey);
        switch (key) {
            case 'Alt':
                source.alt = false;
                break;
            case 'Shift':
                source.shift = false;
                break;
            case 'Control':
                source.ctrl = false;
                break;
            case 'Meta':
                source.meta = false;
                break;
        }
        source.pressed.delete(key);
        const { modifiers } = source;
        // --- Platform-specific code begins here ---
        // The spread is a little hack so JS gives us an array of unicode characters
        // to measure.
        const unmodifiedText = getKeyEventUnmodifiedText(key, source);
        const text = getKeyEventText(code ?? '', source) ?? unmodifiedText;
        return this.#context.cdpTarget.cdpClient.sendCommand('Input.dispatchKeyEvent', {
            type: 'keyUp',
            windowsVirtualKeyCode: USKeyboardLayout_js_1.KeyToKeyCode[key],
            key,
            code,
            text,
            unmodifiedText,
            location: location < 3 ? location : undefined,
            isSystemKey: source.alt || undefined,
            isKeypad: location === 3,
            modifiers,
        });
        // --- Platform-specific code ends here ---
    }
}
ActionDispatcher$1.ActionDispatcher = ActionDispatcher;
const getKeyEventUnmodifiedText = (key, source) => {
    if (key === 'Enter') {
        return '\r';
    }
    return [...key].length === 1
        ? source.shift
            ? key.toLocaleUpperCase('en-US')
            : key
        : undefined;
};
const getKeyEventText = (code, source) => {
    if (source.ctrl) {
        switch (code) {
            case 'Digit2':
                if (source.shift) {
                    return '\x00';
                }
                break;
            case 'KeyA':
                return '\x01';
            case 'KeyB':
                return '\x02';
            case 'KeyC':
                return '\x03';
            case 'KeyD':
                return '\x04';
            case 'KeyE':
                return '\x05';
            case 'KeyF':
                return '\x06';
            case 'KeyG':
                return '\x07';
            case 'KeyH':
                return '\x08';
            case 'KeyI':
                return '\x09';
            case 'KeyJ':
                return '\x0A';
            case 'KeyK':
                return '\x0B';
            case 'KeyL':
                return '\x0C';
            case 'KeyM':
                return '\x0D';
            case 'KeyN':
                return '\x0E';
            case 'KeyO':
                return '\x0F';
            case 'KeyP':
                return '\x10';
            case 'KeyQ':
                return '\x11';
            case 'KeyR':
                return '\x12';
            case 'KeyS':
                return '\x13';
            case 'KeyT':
                return '\x14';
            case 'KeyU':
                return '\x15';
            case 'KeyV':
                return '\x16';
            case 'KeyW':
                return '\x17';
            case 'KeyX':
                return '\x18';
            case 'KeyY':
                return '\x19';
            case 'KeyZ':
                return '\x1A';
            case 'BracketLeft':
                return '\x1B';
            case 'Backslash':
                return '\x1C';
            case 'BracketRight':
                return '\x1D';
            case 'Digit6':
                if (source.shift) {
                    return '\x1E';
                }
                break;
            case 'Minus':
                return '\x1F';
        }
        return '';
    }
    if (source.alt) {
        return '';
    }
    return;
};

var PreloadScriptStorage$1 = {};

Object.defineProperty(PreloadScriptStorage$1, "__esModule", { value: true });
PreloadScriptStorage$1.PreloadScriptStorage = void 0;
/**
 * Container class for preload scripts.
 */
class PreloadScriptStorage {
    /** Tracks all BiDi preload scripts.  */
    #scripts = new Set();
    /** Finds all entries that match the given filter. */
    findPreloadScripts(filter) {
        if (!filter) {
            return [...this.#scripts];
        }
        return [...this.#scripts].filter((script) => {
            if (filter.id !== undefined && filter.id !== script.id) {
                return false;
            }
            if (filter.contextId !== undefined &&
                filter.contextId !== script.contextId) {
                return false;
            }
            if (filter.contextIds !== undefined &&
                !filter.contextIds.includes(script.contextId)) {
                return false;
            }
            if (filter.targetId !== undefined &&
                !script.targetIds.has(filter.targetId)) {
                return false;
            }
            return true;
        });
    }
    addPreloadScript(preloadScript) {
        this.#scripts.add(preloadScript);
    }
    /** Deletes all BiDi preload script entries that match the given filter. */
    removeBiDiPreloadScripts(filter) {
        for (const preloadScript of this.findPreloadScripts(filter)) {
            this.#scripts.delete(preloadScript);
        }
    }
}
PreloadScriptStorage$1.PreloadScriptStorage = PreloadScriptStorage;

var browsingContextImpl = {};

var unitConversions = {};

/**
 * Copyright 2023 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(unitConversions, "__esModule", { value: true });
unitConversions.inchesFromCm = void 0;
/** @return Given an input in cm, convert it to inches. */
function inchesFromCm(cm) {
    return cm / 2.54;
}
unitConversions.inchesFromCm = inchesFromCm;

var deferred = {};

/**
 * Copyright 2022 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(deferred, "__esModule", { value: true });
deferred.Deferred = void 0;
class Deferred {
    #isFinished = false;
    #promise;
    #resolve;
    #reject;
    get isFinished() {
        return this.#isFinished;
    }
    constructor() {
        this.#promise = new Promise((resolve, reject) => {
            this.#resolve = resolve;
            this.#reject = reject;
        });
        // Needed to avoid `Uncaught (in promise)`. The promises returned by `then`
        // and `catch` will be rejected anyway.
        this.#promise.catch((_error) => {
            // Intentionally empty.
        });
    }
    then(onFulfilled, onRejected) {
        return this.#promise.then(onFulfilled, onRejected);
    }
    catch(onRejected) {
        return this.#promise.catch(onRejected);
    }
    resolve(value) {
        this.#isFinished = true;
        this.#resolve?.(value);
    }
    reject(reason) {
        this.#isFinished = true;
        this.#reject?.(reason);
    }
    finally(onFinally) {
        return this.#promise.finally(onFinally);
    }
    [Symbol.toStringTag] = 'Promise';
}
deferred.Deferred = Deferred;

var realm = {};

var scriptEvaluator = {};

var channelProxy = {};

var uuid = {};

/**
 * Copyright 2023 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(uuid, "__esModule", { value: true });
uuid.uuidv4 = void 0;
/**
 * Generates a random v4 UUID, as specified in RFC4122.
 *
 * Uses the native Web Crypto API if available, otherwise falls back to a
 * polyfill.
 *
 * Example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
 */
function uuidv4() {
    // Available only in secure contexts
    // https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API
    if ('crypto' in globalThis && 'randomUUID' in globalThis.crypto) {
        // Node with
        // https://nodejs.org/dist/latest-v20.x/docs/api/globals.html#crypto_1 or
        // secure browser context.
        return globalThis.crypto.randomUUID();
    }
    const randomValues = new Uint8Array(16);
    if ('crypto' in globalThis && 'getRandomValues' in globalThis.crypto) {
        // Node with
        // https://nodejs.org/dist/latest-v20.x/docs/api/globals.html#crypto_1 or
        // browser.
        globalThis.crypto.getRandomValues(randomValues);
    }
    else {
        // Node without
        // https://nodejs.org/dist/latest-v20.x/docs/api/globals.html#crypto_1.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require$$2.webcrypto.getRandomValues(randomValues);
    }
    // Set version (4) and variant (RFC4122) bits.
    randomValues[6] = (randomValues[6] & 0x0f) | 0x40;
    randomValues[8] = (randomValues[8] & 0x3f) | 0x80;
    const bytesToHex = (bytes) => bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
    return [
        bytesToHex(randomValues.subarray(0, 4)),
        bytesToHex(randomValues.subarray(4, 6)),
        bytesToHex(randomValues.subarray(6, 8)),
        bytesToHex(randomValues.subarray(8, 10)),
        bytesToHex(randomValues.subarray(10, 16)),
    ].join('-');
}
uuid.uuidv4 = uuidv4;

/*
 * Copyright 2023 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */
Object.defineProperty(channelProxy, "__esModule", { value: true });
channelProxy.ChannelProxy = void 0;
const protocol_js_1$a = protocol;
const uuid_1 = uuid;
/**
 * Used to send messages from realm to BiDi user.
 */
class ChannelProxy {
    #properties;
    #id = (0, uuid_1.uuidv4)();
    constructor(channel) {
        if (![0, null, undefined].includes(channel.serializationOptions?.maxDomDepth)) {
            throw new Error('serializationOptions.maxDomDepth other than 0 or null is not supported');
        }
        if (![undefined, 'none'].includes(channel.serializationOptions?.includeShadowTree)) {
            throw new Error('serializationOptions.includeShadowTree other than "none" is not supported');
        }
        this.#properties = channel;
    }
    /**
     * Creates a channel proxy in the given realm, initialises listener and
     * returns a handle to `sendMessage` delegate.
     */
    async init(realm, eventManager) {
        const channelHandle = await ChannelProxy.#createAndGetHandleInRealm(realm);
        const sendMessageHandle = await ChannelProxy.#createSendMessageHandle(realm, channelHandle);
        void this.#startListener(realm, channelHandle, eventManager);
        return sendMessageHandle;
    }
    /** Gets a ChannelProxy from window and returns its handle. */
    async startListenerFromWindow(realm, eventManager) {
        const channelHandle = await this.#getHandleFromWindow(realm);
        void this.#startListener(realm, channelHandle, eventManager);
    }
    /**
     * Evaluation string which creates a ChannelProxy object on the client side.
     */
    static #createChannelProxyEvalStr() {
        const functionStr = String(() => {
            const queue = [];
            let queueNonEmptyResolver = null;
            return {
                /**
                 * Gets a promise, which is resolved as soon as a message occurs
                 * in the queue.
                 */
                async getMessage() {
                    const onMessage = queue.length > 0
                        ? Promise.resolve()
                        : new Promise((resolve) => {
                            queueNonEmptyResolver = resolve;
                        });
                    await onMessage;
                    return queue.shift();
                },
                /**
                 * Adds a message to the queue.
                 * Resolves the pending promise if needed.
                 */
                sendMessage(message) {
                    queue.push(message);
                    if (queueNonEmptyResolver !== null) {
                        queueNonEmptyResolver();
                        queueNonEmptyResolver = null;
                    }
                },
            };
        });
        return `(${functionStr})()`;
    }
    /** Creates a ChannelProxy in the given realm. */
    static async #createAndGetHandleInRealm(realm) {
        const createChannelHandleResult = await realm.cdpClient.sendCommand('Runtime.evaluate', {
            expression: this.#createChannelProxyEvalStr(),
            contextId: realm.executionContextId,
            serializationOptions: {
                serialization: 'idOnly',
            },
        });
        if (createChannelHandleResult.exceptionDetails ||
            createChannelHandleResult.result.objectId === undefined) {
            throw new Error(`Cannot create channel`);
        }
        return createChannelHandleResult.result.objectId;
    }
    /** Gets a handle to `sendMessage` delegate from the ChannelProxy handle. */
    static async #createSendMessageHandle(realm, channelHandle) {
        const sendMessageArgResult = await realm.cdpClient.sendCommand('Runtime.callFunctionOn', {
            functionDeclaration: String((channelHandle) => {
                return channelHandle.sendMessage;
            }),
            arguments: [{ objectId: channelHandle }],
            executionContextId: realm.executionContextId,
            serializationOptions: {
                serialization: 'idOnly',
            },
        });
        // TODO: check for exceptionDetails.
        return sendMessageArgResult.result.objectId;
    }
    /** Starts listening for the channel events of the provided ChannelProxy. */
    async #startListener(realm, channelHandle, eventManager) {
        // TODO(#294): Remove this loop after the realm is destroyed.
        // Rely on the CDP throwing exception in such a case.
        // noinspection InfiniteLoopJS
        for (;;) {
            const message = await realm.cdpClient.sendCommand('Runtime.callFunctionOn', {
                functionDeclaration: String(async (channelHandle) => channelHandle.getMessage()),
                arguments: [
                    {
                        objectId: channelHandle,
                    },
                ],
                awaitPromise: true,
                executionContextId: realm.executionContextId,
                serializationOptions: {
                    serialization: 'deep',
                    ...(this.#properties.serializationOptions?.maxObjectDepth ===
                        undefined ||
                        this.#properties.serializationOptions.maxObjectDepth === null
                        ? {}
                        : {
                            maxDepth: this.#properties.serializationOptions.maxObjectDepth,
                        }),
                },
            });
            if (message.exceptionDetails) {
                // TODO: add logging.
                // TODO: check if a error should be thrown.
                return;
            }
            eventManager.registerEvent({
                method: protocol_js_1$a.Script.EventNames.MessageEvent,
                params: {
                    channel: this.#properties.channel,
                    data: realm.cdpToBidiValue(message, this.#properties.ownership ?? 'none'),
                    source: {
                        realm: realm.realmId,
                        context: realm.browsingContextId,
                    },
                },
            }, realm.browsingContextId);
        }
    }
    /**
     * Returns a handle of ChannelProxy from window's property which was set there
     * by `getEvalInWindowStr`. If window property is not set yet, sets a promise
     * resolver to the window property, so that `getEvalInWindowStr` can resolve
     * the promise later on with the channel.
     * This is needed because `getEvalInWindowStr` can be called before or
     * after this method.
     */
    async #getHandleFromWindow(realm) {
        const channelHandleResult = await realm.cdpClient.sendCommand('Runtime.callFunctionOn', {
            functionDeclaration: String((id) => {
                const w = window;
                if (w[id] === undefined) {
                    // The channelProxy is not created yet. Create a promise, put the
                    // resolver to window property and return the promise.
                    // `getEvalInWindowStr` will resolve the promise later.
                    return new Promise((resolve) => (w[id] = resolve));
                }
                // The channelProxy is already created by `getEvalInWindowStr` and
                // is set into window property. Return it.
                const channelProxy = w[id];
                delete w[id];
                return channelProxy;
            }),
            arguments: [{ value: this.#id }],
            executionContextId: realm.executionContextId,
            awaitPromise: true,
            serializationOptions: {
                serialization: 'idOnly',
            },
        });
        if (channelHandleResult.exceptionDetails !== undefined ||
            channelHandleResult.result.objectId === undefined) {
            throw new Error(`ChannelHandle not found in window["${this.#id}"]`);
        }
        return channelHandleResult.result.objectId;
    }
    /**
     * String to be evaluated to create a ProxyChannel and put it to window.
     * Returns the delegate `sendMessage`. Used to provide an argument for preload
     * script. Does the following:
     * 1. Creates a ChannelProxy.
     * 2. Puts the ChannelProxy to window['${this.#id}'] or resolves the promise
     *    by calling delegate stored in window['${this.#id}'].
     *    This is needed because `#getHandleFromWindow` can be called before or
     *    after this method.
     * 3. Returns the delegate `sendMessage` of the created ChannelProxy.
     */
    getEvalInWindowStr() {
        const delegate = String((id, channelProxy) => {
            const w = window;
            if (w[id] === undefined) {
                // `#getHandleFromWindow` is not initialized yet, and will get the
                // channelProxy later.
                w[id] = channelProxy;
            }
            else {
                // `#getHandleFromWindow` is already set a delegate to window property
                // and is waiting for it to be called with the channelProxy.
                w[id](channelProxy);
                delete w[id];
            }
            return channelProxy.sendMessage;
        });
        const channelProxyEval = ChannelProxy.#createChannelProxyEvalStr();
        return `(${delegate})('${this.#id}',${channelProxyEval})`;
    }
}
channelProxy.ChannelProxy = ChannelProxy;

(function (exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.ScriptEvaluator = exports.SHARED_ID_DIVIDER = void 0;
	const protocol_js_1 = protocol;
	const channelProxy_js_1 = channelProxy;
	// As `script.evaluate` wraps call into serialization script, `lineNumber`
	// should be adjusted.
	const CALL_FUNCTION_STACKTRACE_LINE_OFFSET = 1;
	const EVALUATE_STACKTRACE_LINE_OFFSET = 0;
	exports.SHARED_ID_DIVIDER = '_element_';
	class ScriptEvaluator {
	    #eventManager;
	    constructor(eventManager) {
	        this.#eventManager = eventManager;
	    }
	    /**
	     * Gets the string representation of an object. This is equivalent to
	     * calling toString() on the object value.
	     * @param cdpObject CDP remote object representing an object.
	     * @param realm
	     * @return string The stringified object.
	     */
	    static async stringifyObject(cdpObject, realm) {
	        const stringifyResult = await realm.cdpClient.sendCommand('Runtime.callFunctionOn', {
	            functionDeclaration: String((obj) => {
	                return String(obj);
	            }),
	            awaitPromise: false,
	            arguments: [cdpObject],
	            returnByValue: true,
	            executionContextId: realm.executionContextId,
	        });
	        return stringifyResult.result.value;
	    }
	    /**
	     * Serializes a given CDP object into BiDi, keeping references in the
	     * target's `globalThis`.
	     * @param cdpRemoteObject CDP remote object to be serialized.
	     * @param resultOwnership Indicates desired ResultOwnership.
	     * @param realm
	     */
	    async serializeCdpObject(cdpRemoteObject, resultOwnership, realm) {
	        const arg = ScriptEvaluator.#cdpRemoteObjectToCallArgument(cdpRemoteObject);
	        const cdpWebDriverValue = await realm.cdpClient.sendCommand('Runtime.callFunctionOn', {
	            functionDeclaration: String((obj) => obj),
	            awaitPromise: false,
	            arguments: [arg],
	            serializationOptions: {
	                serialization: 'deep',
	            },
	            executionContextId: realm.executionContextId,
	        });
	        return realm.cdpToBidiValue(cdpWebDriverValue, resultOwnership);
	    }
	    async scriptEvaluate(realm, expression, awaitPromise, resultOwnership, serializationOptions) {
	        if (![0, null, undefined].includes(serializationOptions.maxDomDepth))
	            throw new Error('serializationOptions.maxDomDepth other than 0 or null is not supported');
	        const cdpEvaluateResult = await realm.cdpClient.sendCommand('Runtime.evaluate', {
	            contextId: realm.executionContextId,
	            expression,
	            awaitPromise,
	            serializationOptions: {
	                serialization: 'deep',
	                ...(serializationOptions.maxObjectDepth === undefined ||
	                    serializationOptions.maxObjectDepth === null
	                    ? {}
	                    : { maxDepth: serializationOptions.maxObjectDepth }),
	            },
	        });
	        if (cdpEvaluateResult.exceptionDetails) {
	            // Serialize exception details.
	            return {
	                exceptionDetails: await this.#serializeCdpExceptionDetails(cdpEvaluateResult.exceptionDetails, EVALUATE_STACKTRACE_LINE_OFFSET, resultOwnership, realm),
	                type: 'exception',
	                realm: realm.realmId,
	            };
	        }
	        return {
	            type: 'success',
	            result: realm.cdpToBidiValue(cdpEvaluateResult, resultOwnership),
	            realm: realm.realmId,
	        };
	    }
	    async callFunction(realm, functionDeclaration, _this, _arguments, awaitPromise, resultOwnership, serializationOptions) {
	        if (![0, null, undefined].includes(serializationOptions.maxDomDepth))
	            throw new Error('serializationOptions.maxDomDepth other than 0 or null is not supported');
	        const callFunctionAndSerializeScript = `(...args)=>{ return _callFunction((\n${functionDeclaration}\n), args);
      function _callFunction(f, args) {
        const deserializedThis = args.shift();
        const deserializedArgs = args;
        return f.apply(deserializedThis, deserializedArgs);
      }}`;
	        const thisAndArgumentsList = [
	            await this.#deserializeToCdpArg(_this, realm),
	        ];
	        thisAndArgumentsList.push(...(await Promise.all(_arguments.map(async (a) => {
	            return this.#deserializeToCdpArg(a, realm);
	        }))));
	        let cdpCallFunctionResult;
	        try {
	            cdpCallFunctionResult = await realm.cdpClient.sendCommand('Runtime.callFunctionOn', {
	                functionDeclaration: callFunctionAndSerializeScript,
	                awaitPromise,
	                arguments: thisAndArgumentsList,
	                serializationOptions: {
	                    serialization: 'deep',
	                    ...(serializationOptions.maxObjectDepth === undefined ||
	                        serializationOptions.maxObjectDepth === null
	                        ? {}
	                        : { maxDepth: serializationOptions.maxObjectDepth }),
	                },
	                executionContextId: realm.executionContextId,
	            });
	        }
	        catch (e) {
	            // Heuristic to determine if the problem is in the argument.
	            // The check can be done on the `deserialization` step, but this approach
	            // helps to save round-trips.
	            if (e.code === -32000 &&
	                [
	                    'Could not find object with given id',
	                    'Argument should belong to the same JavaScript world as target object',
	                    'Invalid remote object id',
	                ].includes(e.message)) {
	                throw new protocol_js_1.Message.NoSuchHandleException('Handle was not found.');
	            }
	            throw e;
	        }
	        if (cdpCallFunctionResult.exceptionDetails) {
	            // Serialize exception details.
	            return {
	                exceptionDetails: await this.#serializeCdpExceptionDetails(cdpCallFunctionResult.exceptionDetails, CALL_FUNCTION_STACKTRACE_LINE_OFFSET, resultOwnership, realm),
	                type: 'exception',
	                realm: realm.realmId,
	            };
	        }
	        return {
	            type: 'success',
	            result: realm.cdpToBidiValue(cdpCallFunctionResult, resultOwnership),
	            realm: realm.realmId,
	        };
	    }
	    static #cdpRemoteObjectToCallArgument(cdpRemoteObject) {
	        if (cdpRemoteObject.objectId !== undefined) {
	            return { objectId: cdpRemoteObject.objectId };
	        }
	        if (cdpRemoteObject.unserializableValue !== undefined) {
	            return { unserializableValue: cdpRemoteObject.unserializableValue };
	        }
	        return { value: cdpRemoteObject.value };
	    }
	    async #deserializeToCdpArg(argumentValue, realm) {
	        if ('sharedId' in argumentValue) {
	            const [navigableId, rawBackendNodeId] = argumentValue.sharedId.split(exports.SHARED_ID_DIVIDER);
	            const backendNodeId = parseInt(rawBackendNodeId ?? '');
	            if (isNaN(backendNodeId) ||
	                backendNodeId === undefined ||
	                navigableId === undefined) {
	                throw new protocol_js_1.Message.NoSuchNodeException(`SharedId "${argumentValue.sharedId}" was not found.`);
	            }
	            if (realm.navigableId !== navigableId) {
	                throw new protocol_js_1.Message.NoSuchNodeException(`SharedId "${argumentValue.sharedId}" belongs to different document. Current document is ${realm.navigableId}.`);
	            }
	            try {
	                const obj = await realm.cdpClient.sendCommand('DOM.resolveNode', {
	                    backendNodeId,
	                    executionContextId: realm.executionContextId,
	                });
	                // TODO(#375): Release `obj.object.objectId` after using.
	                return { objectId: obj.object.objectId };
	            }
	            catch (e) {
	                // Heuristic to detect "no such node" exception. Based on the  specific
	                // CDP implementation.
	                if (e.code === -32000 && e.message === 'No node with given id found') {
	                    throw new protocol_js_1.Message.NoSuchNodeException(`SharedId "${argumentValue.sharedId}" was not found.`);
	                }
	                throw e;
	            }
	        }
	        if ('handle' in argumentValue) {
	            return { objectId: argumentValue.handle };
	        }
	        switch (argumentValue.type) {
	            // Primitive Protocol Value
	            // https://w3c.github.io/webdriver-bidi/#data-types-protocolValue-primitiveProtocolValue
	            case 'undefined':
	                return { unserializableValue: 'undefined' };
	            case 'null':
	                return { unserializableValue: 'null' };
	            case 'string':
	                return { value: argumentValue.value };
	            case 'number':
	                if (argumentValue.value === 'NaN') {
	                    return { unserializableValue: 'NaN' };
	                }
	                else if (argumentValue.value === '-0') {
	                    return { unserializableValue: '-0' };
	                }
	                else if (argumentValue.value === 'Infinity') {
	                    return { unserializableValue: 'Infinity' };
	                }
	                else if (argumentValue.value === '-Infinity') {
	                    return { unserializableValue: '-Infinity' };
	                }
	                return {
	                    value: argumentValue.value,
	                };
	            case 'boolean':
	                return { value: Boolean(argumentValue.value) };
	            case 'bigint':
	                return {
	                    unserializableValue: `BigInt(${JSON.stringify(argumentValue.value)})`,
	                };
	            case 'date':
	                return {
	                    unserializableValue: `new Date(Date.parse(${JSON.stringify(argumentValue.value)}))`,
	                };
	            case 'regexp':
	                return {
	                    unserializableValue: `new RegExp(${JSON.stringify(argumentValue.value.pattern)}, ${JSON.stringify(argumentValue.value.flags)})`,
	                };
	            case 'map': {
	                // TODO: If none of the nested keys and values has a remote
	                // reference, serialize to `unserializableValue` without CDP roundtrip.
	                const keyValueArray = await this.#flattenKeyValuePairs(argumentValue.value, realm);
	                const argEvalResult = await realm.cdpClient.sendCommand('Runtime.callFunctionOn', {
	                    functionDeclaration: String((...args) => {
	                        const result = new Map();
	                        for (let i = 0; i < args.length; i += 2) {
	                            result.set(args[i], args[i + 1]);
	                        }
	                        return result;
	                    }),
	                    awaitPromise: false,
	                    arguments: keyValueArray,
	                    returnByValue: false,
	                    executionContextId: realm.executionContextId,
	                });
	                // TODO(#375): Release `argEvalResult.result.objectId` after using.
	                return { objectId: argEvalResult.result.objectId };
	            }
	            case 'object': {
	                // TODO: If none of the nested keys and values has a remote
	                //  reference, serialize to `unserializableValue` without CDP roundtrip.
	                const keyValueArray = await this.#flattenKeyValuePairs(argumentValue.value, realm);
	                const argEvalResult = await realm.cdpClient.sendCommand('Runtime.callFunctionOn', {
	                    functionDeclaration: String((...args) => {
	                        const result = {};
	                        for (let i = 0; i < args.length; i += 2) {
	                            // Key should be either `string`, `number`, or `symbol`.
	                            const key = args[i];
	                            result[key] = args[i + 1];
	                        }
	                        return result;
	                    }),
	                    awaitPromise: false,
	                    arguments: keyValueArray,
	                    returnByValue: false,
	                    executionContextId: realm.executionContextId,
	                });
	                // TODO(#375): Release `argEvalResult.result.objectId` after using.
	                return { objectId: argEvalResult.result.objectId };
	            }
	            case 'array': {
	                // TODO: If none of the nested items has a remote reference,
	                // serialize to `unserializableValue` without CDP roundtrip.
	                const args = await this.#flattenValueList(argumentValue.value, realm);
	                const argEvalResult = await realm.cdpClient.sendCommand('Runtime.callFunctionOn', {
	                    functionDeclaration: String((...args) => {
	                        return args;
	                    }),
	                    awaitPromise: false,
	                    arguments: args,
	                    returnByValue: false,
	                    executionContextId: realm.executionContextId,
	                });
	                // TODO(#375): Release `argEvalResult.result.objectId` after using.
	                return { objectId: argEvalResult.result.objectId };
	            }
	            case 'set': {
	                // TODO: if none of the nested items has a remote reference,
	                // serialize to `unserializableValue` without CDP roundtrip.
	                const args = await this.#flattenValueList(argumentValue.value, realm);
	                const argEvalResult = await realm.cdpClient.sendCommand('Runtime.callFunctionOn', {
	                    functionDeclaration: String((...args) => {
	                        return new Set(args);
	                    }),
	                    awaitPromise: false,
	                    arguments: args,
	                    returnByValue: false,
	                    executionContextId: realm.executionContextId,
	                });
	                // TODO(#375): Release `argEvalResult.result.objectId` after using.
	                return { objectId: argEvalResult.result.objectId };
	            }
	            case 'channel': {
	                const channelProxy = new channelProxy_js_1.ChannelProxy(argumentValue.value);
	                const channelProxySendMessageHandle = await channelProxy.init(realm, this.#eventManager);
	                return { objectId: channelProxySendMessageHandle };
	            }
	            // TODO(#375): Dispose of nested objects.
	            default:
	                throw new Error(`Value ${JSON.stringify(argumentValue)} is not deserializable.`);
	        }
	    }
	    async #flattenKeyValuePairs(mapping, realm) {
	        const keyValueArray = [];
	        for (const [key, value] of mapping) {
	            let keyArg;
	            if (typeof key === 'string') {
	                // Key is a string.
	                keyArg = { value: key };
	            }
	            else {
	                // Key is a serialized value.
	                keyArg = await this.#deserializeToCdpArg(key, realm);
	            }
	            const valueArg = await this.#deserializeToCdpArg(value, realm);
	            keyValueArray.push(keyArg);
	            keyValueArray.push(valueArg);
	        }
	        return keyValueArray;
	    }
	    async #flattenValueList(list, realm) {
	        return Promise.all(list.map((value) => this.#deserializeToCdpArg(value, realm)));
	    }
	    async #serializeCdpExceptionDetails(cdpExceptionDetails, lineOffset, resultOwnership, realm) {
	        const callFrames = cdpExceptionDetails.stackTrace?.callFrames.map((frame) => ({
	            url: frame.url,
	            functionName: frame.functionName,
	            // As `script.evaluate` wraps call into serialization script, so
	            // `lineNumber` should be adjusted.
	            lineNumber: frame.lineNumber - lineOffset,
	            columnNumber: frame.columnNumber,
	        }));
	        const exception = await this.serializeCdpObject(
	        // Exception should always be there.
	        cdpExceptionDetails.exception, resultOwnership, realm);
	        const text = await ScriptEvaluator.stringifyObject(cdpExceptionDetails.exception, realm);
	        return {
	            exception,
	            columnNumber: cdpExceptionDetails.columnNumber,
	            // As `script.evaluate` wraps call into serialization script, so
	            // `lineNumber` should be adjusted.
	            lineNumber: cdpExceptionDetails.lineNumber - lineOffset,
	            stackTrace: {
	                callFrames: callFrames ?? [],
	            },
	            text: text || cdpExceptionDetails.text,
	        };
	    }
	}
	exports.ScriptEvaluator = ScriptEvaluator;
	
} (scriptEvaluator));

/**
 * Copyright 2022 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(realm, "__esModule", { value: true });
realm.Realm = void 0;
const protocol_js_1$9 = protocol;
const log_js_1$4 = log;
const scriptEvaluator_js_1 = scriptEvaluator;
class Realm {
    #realmStorage;
    #browsingContextStorage;
    #realmId;
    #browsingContextId;
    #executionContextId;
    #origin;
    #type;
    #cdpClient;
    #eventManager;
    #scriptEvaluator;
    sandbox;
    cdpSessionId;
    #logger;
    constructor(realmStorage, browsingContextStorage, realmId, browsingContextId, executionContextId, origin, type, sandbox, cdpSessionId, cdpClient, eventManager, logger) {
        this.#realmId = realmId;
        this.#browsingContextId = browsingContextId;
        this.#executionContextId = executionContextId;
        this.sandbox = sandbox;
        this.#origin = origin;
        this.#type = type;
        this.cdpSessionId = cdpSessionId;
        this.#cdpClient = cdpClient;
        this.#realmStorage = realmStorage;
        this.#browsingContextStorage = browsingContextStorage;
        this.#eventManager = eventManager;
        this.#scriptEvaluator = new scriptEvaluator_js_1.ScriptEvaluator(this.#eventManager);
        this.#realmStorage.addRealm(this);
        this.#logger = logger;
        this.#eventManager.registerEvent({
            method: protocol_js_1$9.Script.EventNames.RealmCreated,
            params: this.toBiDi(),
        }, this.browsingContextId);
    }
    async #releaseObject(handle) {
        try {
            await this.cdpClient.sendCommand('Runtime.releaseObject', {
                objectId: handle,
            });
        }
        catch (e) {
            // Heuristic to determine if the problem is in the unknown handler.
            // Ignore the error if so.
            if (!(e.code === -32000 && e.message === 'Invalid remote object id')) {
                throw e;
            }
        }
    }
    async disown(handle) {
        // Disowning an object from different realm does nothing.
        if (this.#realmStorage.knownHandlesToRealm.get(handle) !== this.realmId) {
            return;
        }
        await this.#releaseObject(handle);
        this.#realmStorage.knownHandlesToRealm.delete(handle);
    }
    cdpToBidiValue(cdpValue, resultOwnership) {
        const deepSerializedValue = cdpValue.result.deepSerializedValue;
        const bidiValue = this.deepSerializedToBiDi(deepSerializedValue);
        if (cdpValue.result.objectId) {
            const objectId = cdpValue.result.objectId;
            if (resultOwnership === 'root') {
                // Extend BiDi value with `handle` based on required `resultOwnership`
                // and  CDP response but not on the actual BiDi type.
                bidiValue.handle = objectId;
                // Remember all the handles sent to client.
                this.#realmStorage.knownHandlesToRealm.set(objectId, this.realmId);
            }
            else {
                // No need in awaiting for the object to be released.
                void this.#releaseObject(objectId).catch((error) => this.#logger?.(log_js_1$4.LogType.system, error));
            }
        }
        return bidiValue;
    }
    deepSerializedToBiDi(webDriverValue) {
        // This relies on the CDP to implement proper BiDi serialization, except
        // backendNodeId/sharedId and `platformobject`.
        const result = webDriverValue;
        if (Object.hasOwn(result, 'weakLocalObjectReference')) {
            result.internalId = `${result.weakLocalObjectReference}`;
            delete result['weakLocalObjectReference'];
        }
        // Platform object is a special case. It should have only `{type: object}`
        // without `value` field.
        if (result.type === 'platformobject') {
            return { type: 'object' };
        }
        const bidiValue = result.value;
        if (bidiValue === undefined) {
            return result;
        }
        if (result.type === 'node') {
            if (Object.hasOwn(bidiValue, 'backendNodeId')) {
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                result.sharedId = `${this.navigableId}${scriptEvaluator_js_1.SHARED_ID_DIVIDER}${bidiValue.backendNodeId}`;
                delete bidiValue['backendNodeId'];
            }
            if (Object.hasOwn(bidiValue, 'children')) {
                for (const i in bidiValue.children) {
                    bidiValue.children[i] = this.deepSerializedToBiDi(bidiValue.children[i]);
                }
            }
        }
        // Recursively update the nested values.
        if (['array', 'set'].includes(webDriverValue.type)) {
            for (const i in bidiValue) {
                bidiValue[i] = this.deepSerializedToBiDi(bidiValue[i]);
            }
        }
        if (['object', 'map'].includes(webDriverValue.type)) {
            for (const i in bidiValue) {
                bidiValue[i] = [
                    this.deepSerializedToBiDi(bidiValue[i][0]),
                    this.deepSerializedToBiDi(bidiValue[i][1]),
                ];
            }
        }
        return result;
    }
    toBiDi() {
        return {
            realm: this.realmId,
            origin: this.origin,
            type: this.type,
            context: this.browsingContextId,
            ...(this.sandbox === undefined ? {} : { sandbox: this.sandbox }),
        };
    }
    get realmId() {
        return this.#realmId;
    }
    get navigableId() {
        return (this.#browsingContextStorage.findContext(this.#browsingContextId)
            ?.navigableId ?? 'UNKNOWN');
    }
    get browsingContextId() {
        return this.#browsingContextId;
    }
    get executionContextId() {
        return this.#executionContextId;
    }
    get origin() {
        return this.#origin;
    }
    get type() {
        return this.#type;
    }
    get cdpClient() {
        return this.#cdpClient;
    }
    async callFunction(functionDeclaration, _this, _arguments, awaitPromise, resultOwnership, serializationOptions) {
        const context = this.#browsingContextStorage.getContext(this.browsingContextId);
        await context.awaitUnblocked();
        return {
            result: await this.#scriptEvaluator.callFunction(this, functionDeclaration, _this, _arguments, awaitPromise, resultOwnership, serializationOptions),
        };
    }
    async scriptEvaluate(expression, awaitPromise, resultOwnership, serializationOptions) {
        const context = this.#browsingContextStorage.getContext(this.browsingContextId);
        await context.awaitUnblocked();
        return {
            result: await this.#scriptEvaluator.scriptEvaluate(this, expression, awaitPromise, resultOwnership, serializationOptions),
        };
    }
    /**
     * Serializes a given CDP object into BiDi, keeping references in the
     * target's `globalThis`.
     * @param cdpObject CDP remote object to be serialized.
     * @param resultOwnership Indicates desired ResultOwnership.
     */
    async serializeCdpObject(cdpObject, resultOwnership) {
        return this.#scriptEvaluator.serializeCdpObject(cdpObject, resultOwnership, this);
    }
    /**
     * Gets the string representation of an object. This is equivalent to
     * calling toString() on the object value.
     * @param cdpObject CDP remote object representing an object.
     * @return string The stringified object.
     */
    async stringifyObject(cdpObject) {
        return scriptEvaluator_js_1.ScriptEvaluator.stringifyObject(cdpObject, this);
    }
    delete() {
        this.#eventManager.registerEvent({
            method: protocol_js_1$9.Script.EventNames.RealmDestroyed,
            params: {
                realm: this.realmId,
            },
        }, this.browsingContextId);
    }
}
realm.Realm = Realm;

/**
 * Copyright 2022 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(browsingContextImpl, "__esModule", { value: true });
browsingContextImpl.BrowsingContextImpl = void 0;
const unitConversions_js_1 = unitConversions;
const protocol_js_1$8 = protocol;
const log_js_1$3 = log;
const deferred_js_1$2 = deferred;
const realm_js_1 = realm;
class BrowsingContextImpl {
    /** The ID of this browsing context. */
    #id;
    /**
     * The ID of the parent browsing context.
     * If null, this is a top-level context.
     */
    #parentId;
    /** Direct children browsing contexts. */
    #children = new Set();
    #browsingContextStorage;
    #deferreds = {
        documentInitialized: new deferred_js_1$2.Deferred(),
        Page: {
            navigatedWithinDocument: new deferred_js_1$2.Deferred(),
            lifecycleEvent: {
                DOMContentLoaded: new deferred_js_1$2.Deferred(),
                load: new deferred_js_1$2.Deferred(),
            },
        },
    };
    #url = 'about:blank';
    #eventManager;
    #realmStorage;
    #loaderId;
    #cdpTarget;
    #maybeDefaultRealm;
    #isNavigating = false;
    #logger;
    constructor(cdpTarget, realmStorage, id, parentId, eventManager, browsingContextStorage, logger) {
        this.#cdpTarget = cdpTarget;
        this.#realmStorage = realmStorage;
        this.#id = id;
        this.#parentId = parentId;
        this.#eventManager = eventManager;
        this.#browsingContextStorage = browsingContextStorage;
        this.#logger = logger;
    }
    static create(cdpTarget, realmStorage, id, parentId, eventManager, browsingContextStorage, logger) {
        const context = new BrowsingContextImpl(cdpTarget, realmStorage, id, parentId, eventManager, browsingContextStorage, logger);
        context.#initListeners();
        browsingContextStorage.addContext(context);
        if (!context.isTopLevelContext()) {
            context.parent.addChild(context.id);
        }
        eventManager.registerEvent({
            method: protocol_js_1$8.BrowsingContext.EventNames.ContextCreatedEvent,
            params: context.serializeToBidiValue(),
        }, context.id);
        return context;
    }
    static getTimestamp() {
        // `timestamp` from the event is MonotonicTime, not real time, so
        // the best Mapper can do is to set the timestamp to the epoch time
        // of the event arrived.
        // https://chromedevtools.github.io/devtools-protocol/tot/Network/#type-MonotonicTime
        return new Date().getTime();
    }
    /**
     * @see https://html.spec.whatwg.org/multipage/document-sequences.html#navigable
     */
    get navigableId() {
        return this.#loaderId;
    }
    delete() {
        this.#deleteAllChildren();
        this.#realmStorage.deleteRealms({
            browsingContextId: this.id,
        });
        // Remove context from the parent.
        if (!this.isTopLevelContext()) {
            this.parent.#children.delete(this.id);
        }
        this.#eventManager.registerEvent({
            method: protocol_js_1$8.BrowsingContext.EventNames.ContextDestroyedEvent,
            params: this.serializeToBidiValue(),
        }, this.id);
        this.#browsingContextStorage.deleteContextById(this.id);
    }
    /** Returns the ID of this context. */
    get id() {
        return this.#id;
    }
    /** Returns the parent context ID. */
    get parentId() {
        return this.#parentId;
    }
    /** Returns the parent context. */
    get parent() {
        if (this.parentId === null) {
            return null;
        }
        return this.#browsingContextStorage.getContext(this.parentId);
    }
    /** Returns all direct children contexts. */
    get directChildren() {
        return [...this.#children].map((id) => this.#browsingContextStorage.getContext(id));
    }
    /** Returns all children contexts, flattened. */
    get allChildren() {
        const children = this.directChildren;
        return children.concat(...children.map((child) => child.allChildren));
    }
    /**
     * Returns true if this is a top-level context.
     * This is the case whenever the parent context ID is null.
     */
    isTopLevelContext() {
        return this.#parentId === null;
    }
    get top() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let topContext = this;
        let parent = topContext.parent;
        while (parent) {
            topContext = parent;
            parent = topContext.parent;
        }
        return topContext;
    }
    addChild(childId) {
        this.#children.add(childId);
    }
    #deleteAllChildren() {
        this.directChildren.map((child) => child.delete());
    }
    get #defaultRealm() {
        if (this.#maybeDefaultRealm === undefined) {
            throw new Error(`No default realm for browsing context ${this.#id}`);
        }
        return this.#maybeDefaultRealm;
    }
    get cdpTarget() {
        return this.#cdpTarget;
    }
    updateCdpTarget(cdpTarget) {
        this.#cdpTarget = cdpTarget;
        this.#initListeners();
    }
    get url() {
        return this.#url;
    }
    async awaitLoaded() {
        await this.#deferreds.Page.lifecycleEvent.load;
    }
    awaitUnblocked() {
        return this.#cdpTarget.targetUnblocked;
    }
    async getOrCreateSandbox(sandbox) {
        if (sandbox === undefined || sandbox === '') {
            return this.#defaultRealm;
        }
        let maybeSandboxes = this.#realmStorage.findRealms({
            browsingContextId: this.id,
            sandbox,
        });
        if (maybeSandboxes.length === 0) {
            await this.#cdpTarget.cdpClient.sendCommand('Page.createIsolatedWorld', {
                frameId: this.id,
                worldName: sandbox,
            });
            // `Runtime.executionContextCreated` should be emitted by the time the
            // previous command is done.
            maybeSandboxes = this.#realmStorage.findRealms({
                browsingContextId: this.id,
                sandbox,
            });
        }
        if (maybeSandboxes.length !== 1) {
            throw Error(`Sandbox ${sandbox} wasn't created.`);
        }
        return maybeSandboxes[0];
    }
    serializeToBidiValue(maxDepth = 0, addParentField = true) {
        return {
            context: this.#id,
            url: this.url,
            children: maxDepth > 0
                ? this.directChildren.map((c) => c.serializeToBidiValue(maxDepth - 1, false))
                : null,
            ...(addParentField ? { parent: this.#parentId } : {}),
        };
    }
    onTargetInfoChanged(params) {
        this.#url = params.targetInfo.url;
        if (this.#isNavigating) {
            this.#eventManager.registerEvent({
                method: protocol_js_1$8.BrowsingContext.EventNames.NavigationStarted,
                params: {
                    context: this.id,
                    // TODO: The network event is send before the CDP Page.frameStartedLoading
                    // It theory there should be a way to get the data.
                    navigation: null,
                    timestamp: BrowsingContextImpl.getTimestamp(),
                    url: this.#url,
                },
            }, this.id);
            this.#isNavigating = false;
        }
    }
    #initListeners() {
        this.#cdpTarget.cdpClient.on('Page.frameNavigated', (params) => {
            if (this.id !== params.frame.id) {
                return;
            }
            const timestamp = BrowsingContextImpl.getTimestamp();
            this.#url = params.frame.url + (params.frame.urlFragment ?? '');
            // At the point the page is initialized, all the nested iframes from the
            // previous page are detached and realms are destroyed.
            // Remove children from context.
            this.#deleteAllChildren();
            this.#eventManager.registerEvent({
                method: protocol_js_1$8.BrowsingContext.EventNames.FragmentNavigated,
                params: {
                    context: this.id,
                    navigation: this.#loaderId ?? null,
                    timestamp,
                    url: this.#url,
                },
            }, this.id);
        });
        this.#cdpTarget.cdpClient.on('Page.navigatedWithinDocument', (params) => {
            if (this.id !== params.frameId) {
                return;
            }
            const timestamp = BrowsingContextImpl.getTimestamp();
            this.#url = params.url;
            this.#deferreds.Page.navigatedWithinDocument.resolve(params);
            // TODO: Remove this once History event for BiDi are added
            this.#eventManager.registerEvent({
                method: protocol_js_1$8.BrowsingContext.EventNames.FragmentNavigated,
                params: {
                    context: this.id,
                    navigation: null,
                    timestamp,
                    url: this.#url,
                },
            }, this.id);
        });
        this.#cdpTarget.cdpClient.on('Page.frameStartedLoading', (params) => {
            if (this.id !== params.frameId) {
                return;
            }
            this.#isNavigating = true;
        });
        this.#cdpTarget.cdpClient.on('Page.frameStoppedLoading', (params) => {
            if (this.id !== params.frameId) {
                return;
            }
            this.#isNavigating = false;
        });
        this.#cdpTarget.cdpClient.on('Page.lifecycleEvent', (params) => {
            if (this.id !== params.frameId) {
                return;
            }
            if (params.name === 'init') {
                this.#documentChanged(params.loaderId);
                this.#deferreds.documentInitialized.resolve();
                return;
            }
            if (params.name === 'commit') {
                this.#loaderId = params.loaderId;
                return;
            }
            // Ignore event from not current navigation.
            if (params.loaderId !== this.#loaderId) {
                return;
            }
            const timestamp = BrowsingContextImpl.getTimestamp();
            switch (params.name) {
                case 'DOMContentLoaded':
                    this.#deferreds.Page.lifecycleEvent.DOMContentLoaded.resolve(params);
                    this.#eventManager.registerEvent({
                        method: protocol_js_1$8.BrowsingContext.EventNames.DomContentLoadedEvent,
                        params: {
                            context: this.id,
                            navigation: this.#loaderId ?? null,
                            timestamp,
                            url: this.#url,
                        },
                    }, this.id);
                    break;
                case 'load':
                    this.#deferreds.Page.lifecycleEvent.load.resolve(params);
                    this.#eventManager.registerEvent({
                        method: protocol_js_1$8.BrowsingContext.EventNames.LoadEvent,
                        params: {
                            context: this.id,
                            navigation: this.#loaderId ?? null,
                            timestamp,
                            url: this.#url,
                        },
                    }, this.id);
                    break;
            }
        });
        this.#cdpTarget.cdpClient.on('Runtime.executionContextCreated', (params) => {
            if (params.context.auxData.frameId !== this.id) {
                return;
            }
            // Only this execution contexts are supported for now.
            if (!['default', 'isolated'].includes(params.context.auxData.type)) {
                return;
            }
            const realm = new realm_js_1.Realm(this.#realmStorage, this.#browsingContextStorage, params.context.uniqueId, this.id, params.context.id, this.#getOrigin(params), 
            // XXX: differentiate types.
            'window', 
            // Sandbox name for isolated world.
            params.context.auxData.type === 'isolated'
                ? params.context.name
                : undefined, this.#cdpTarget.cdpSessionId, this.#cdpTarget.cdpClient, this.#eventManager, this.#logger);
            if (params.context.auxData.isDefault) {
                this.#maybeDefaultRealm = realm;
                // Initialize ChannelProxy listeners for all the channels of all the
                // preload scripts related to this BrowsingContext.
                // TODO: extend for not default realms by the sandbox name.
                void Promise.all(this.#cdpTarget
                    .getChannels(this.id)
                    .map((channel) => channel.startListenerFromWindow(realm, this.#eventManager)));
            }
        });
        this.#cdpTarget.cdpClient.on('Runtime.executionContextDestroyed', (params) => {
            this.#realmStorage.deleteRealms({
                cdpSessionId: this.#cdpTarget.cdpSessionId,
                executionContextId: params.executionContextId,
            });
        });
        this.#cdpTarget.cdpClient.on('Runtime.executionContextsCleared', () => {
            this.#realmStorage.deleteRealms({
                cdpSessionId: this.#cdpTarget.cdpSessionId,
            });
        });
    }
    #getOrigin(params) {
        if (params.context.auxData.type === 'isolated') {
            // Sandbox should have the same origin as the context itself, but in CDP
            // it has an empty one.
            return this.#defaultRealm.origin;
        }
        // https://html.spec.whatwg.org/multipage/origin.html#ascii-serialisation-of-an-origin
        return ['://', ''].includes(params.context.origin)
            ? 'null'
            : params.context.origin;
    }
    #documentChanged(loaderId) {
        // Same document navigation.
        if (loaderId === undefined || this.#loaderId === loaderId) {
            if (this.#deferreds.Page.navigatedWithinDocument.isFinished) {
                this.#deferreds.Page.navigatedWithinDocument =
                    new deferred_js_1$2.Deferred();
            }
            else {
                this.#logger?.(log_js_1$3.LogType.browsingContexts, 'Document changed (navigatedWithinDocument)');
            }
            return;
        }
        this.#resetDeferredsIfFinished();
        this.#loaderId = loaderId;
    }
    #resetDeferredsIfFinished() {
        if (this.#deferreds.documentInitialized.isFinished) {
            this.#deferreds.documentInitialized = new deferred_js_1$2.Deferred();
        }
        else {
            this.#logger?.(log_js_1$3.LogType.browsingContexts, 'Document changed (document initialized)');
        }
        if (this.#deferreds.Page.lifecycleEvent.DOMContentLoaded.isFinished) {
            this.#deferreds.Page.lifecycleEvent.DOMContentLoaded =
                new deferred_js_1$2.Deferred();
        }
        else {
            this.#logger?.(log_js_1$3.LogType.browsingContexts, 'Document changed (DOMContentLoaded)');
        }
        if (this.#deferreds.Page.lifecycleEvent.load.isFinished) {
            this.#deferreds.Page.lifecycleEvent.load =
                new deferred_js_1$2.Deferred();
        }
        else {
            this.#logger?.(log_js_1$3.LogType.browsingContexts, 'Document changed (load)');
        }
    }
    async navigate(url, wait) {
        await this.awaitUnblocked();
        // TODO: handle loading errors.
        const cdpNavigateResult = await this.#cdpTarget.cdpClient.sendCommand('Page.navigate', {
            url,
            frameId: this.id,
        });
        if (cdpNavigateResult.errorText) {
            throw new protocol_js_1$8.Message.UnknownErrorException(cdpNavigateResult.errorText);
        }
        this.#documentChanged(cdpNavigateResult.loaderId);
        switch (wait) {
            case 'none':
                break;
            case 'interactive':
                // No `loaderId` means same-document navigation.
                if (cdpNavigateResult.loaderId === undefined) {
                    await this.#deferreds.Page.navigatedWithinDocument;
                }
                else {
                    await this.#deferreds.Page.lifecycleEvent.DOMContentLoaded;
                }
                break;
            case 'complete':
                // No `loaderId` means same-document navigation.
                if (cdpNavigateResult.loaderId === undefined) {
                    await this.#deferreds.Page.navigatedWithinDocument;
                }
                else {
                    await this.awaitLoaded();
                }
                break;
        }
        return {
            result: {
                navigation: cdpNavigateResult.loaderId ?? null,
                url,
            },
        };
    }
    async reload(ignoreCache, wait) {
        await this.awaitUnblocked();
        await this.#cdpTarget.cdpClient.sendCommand('Page.reload', {
            ignoreCache,
        });
        this.#resetDeferredsIfFinished();
        switch (wait) {
            case 'none':
                break;
            case 'interactive':
                await this.#deferreds.Page.lifecycleEvent.DOMContentLoaded;
                break;
            case 'complete':
                await this.awaitLoaded();
                break;
        }
        return { result: {} };
    }
    async setViewport(viewport) {
        if (viewport === null) {
            await this.#cdpTarget.cdpClient.sendCommand('Emulation.clearDeviceMetricsOverride');
        }
        else {
            try {
                await this.#cdpTarget.cdpClient.sendCommand('Emulation.setDeviceMetricsOverride', {
                    width: viewport.width,
                    height: viewport.height,
                    deviceScaleFactor: 0,
                    mobile: false,
                    dontSetVisibleSize: true,
                });
            }
            catch (err) {
                if (err.message.startsWith(
                // https://crsrc.org/c/content/browser/devtools/protocol/emulation_handler.cc;l=257;drc=2f6eee84cf98d4227e7c41718dd71b82f26d90ff
                'Width and height values must be positive')) {
                    throw new protocol_js_1$8.Message.UnsupportedOperationException('Provided viewport dimensions are not supported');
                }
                throw err;
            }
        }
    }
    async captureScreenshot() {
        // XXX: Focus the original tab after the screenshot is taken.
        // This is needed because the screenshot gets blocked until the active tab gets focus.
        await this.#cdpTarget.cdpClient.sendCommand('Page.bringToFront');
        let clip;
        if (this.isTopLevelContext()) {
            const { cssContentSize, cssLayoutViewport } = await this.#cdpTarget.cdpClient.sendCommand('Page.getLayoutMetrics');
            clip = {
                x: cssContentSize.x,
                y: cssContentSize.y,
                width: cssLayoutViewport.clientWidth,
                height: cssLayoutViewport.clientHeight,
            };
        }
        else {
            const { result: { value: iframeDocRect }, } = await this.#cdpTarget.cdpClient.sendCommand('Runtime.callFunctionOn', {
                functionDeclaration: String(() => {
                    const docRect = globalThis.document.documentElement.getBoundingClientRect();
                    return JSON.stringify({
                        x: docRect.x,
                        y: docRect.y,
                        width: docRect.width,
                        height: docRect.height,
                    });
                }),
                executionContextId: this.#defaultRealm.executionContextId,
            });
            clip = JSON.parse(iframeDocRect);
        }
        const result = await this.#cdpTarget.cdpClient.sendCommand('Page.captureScreenshot', {
            clip: {
                ...clip,
                scale: 1.0,
            },
        });
        return {
            result: {
                data: result.data,
            },
        };
    }
    async print(params) {
        const cdpParams = {};
        if (params.background !== undefined) {
            cdpParams.printBackground = params.background;
        }
        if (params.margin?.bottom !== undefined) {
            cdpParams.marginBottom = (0, unitConversions_js_1.inchesFromCm)(params.margin.bottom);
        }
        if (params.margin?.left !== undefined) {
            cdpParams.marginLeft = (0, unitConversions_js_1.inchesFromCm)(params.margin.left);
        }
        if (params.margin?.right !== undefined) {
            cdpParams.marginRight = (0, unitConversions_js_1.inchesFromCm)(params.margin.right);
        }
        if (params.margin?.top !== undefined) {
            cdpParams.marginTop = (0, unitConversions_js_1.inchesFromCm)(params.margin.top);
        }
        if (params.orientation !== undefined) {
            cdpParams.landscape = params.orientation === 'landscape';
        }
        if (params.page?.height !== undefined) {
            cdpParams.paperHeight = (0, unitConversions_js_1.inchesFromCm)(params.page.height);
        }
        if (params.page?.width !== undefined) {
            cdpParams.paperWidth = (0, unitConversions_js_1.inchesFromCm)(params.page.width);
        }
        if (params.pageRanges !== undefined) {
            cdpParams.pageRanges = params.pageRanges.join(',');
        }
        if (params.scale !== undefined) {
            cdpParams.scale = params.scale;
        }
        if (params.shrinkToFit !== undefined) {
            cdpParams.preferCSSPageSize = !params.shrinkToFit;
        }
        const result = await this.#cdpTarget.cdpClient.sendCommand('Page.printToPDF', cdpParams);
        return {
            result: {
                data: result.data,
            },
        };
    }
}
browsingContextImpl.BrowsingContextImpl = BrowsingContextImpl;

var cdpTarget = {};

var logManager = {};

var logHelper = {};

/**
 * Copyright 2022 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(logHelper, "__esModule", { value: true });
logHelper.getRemoteValuesText = logHelper.logMessageFormatter = void 0;
const specifiers = ['%s', '%d', '%i', '%f', '%o', '%O', '%c'];
function isFormmatSpecifier(str) {
    return specifiers.some((spec) => str.includes(spec));
}
/**
 * @param args input remote values to be format printed
 * @return parsed text of the remote values in specific format
 */
function logMessageFormatter(args) {
    let output = '';
    const argFormat = args[0].value.toString();
    const argValues = args.slice(1, undefined);
    const tokens = argFormat.split(new RegExp(specifiers.map((spec) => `(${spec})`).join('|'), 'g'));
    for (const token of tokens) {
        if (token === undefined || token === '') {
            continue;
        }
        if (isFormmatSpecifier(token)) {
            const arg = argValues.shift();
            // raise an exception when less value is provided
            if (arg === undefined) {
                throw new Error(`Less value is provided: "${getRemoteValuesText(args, false)}"`);
            }
            if (token === '%s') {
                output += stringFromArg(arg);
            }
            else if (token === '%d' || token === '%i') {
                if (arg.type === 'bigint' ||
                    arg.type === 'number' ||
                    arg.type === 'string') {
                    output += parseInt(arg.value.toString(), 10);
                }
                else {
                    output += 'NaN';
                }
            }
            else if (token === '%f') {
                if (arg.type === 'bigint' ||
                    arg.type === 'number' ||
                    arg.type === 'string') {
                    output += parseFloat(arg.value.toString());
                }
                else {
                    output += 'NaN';
                }
            }
            else {
                // %o, %O, %c
                output += toJson(arg);
            }
        }
        else {
            output += token;
        }
    }
    // raise an exception when more value is provided
    if (argValues.length > 0) {
        throw new Error(`More value is provided: "${getRemoteValuesText(args, false)}"`);
    }
    return output;
}
logHelper.logMessageFormatter = logMessageFormatter;
/**
 * @param arg input remote value to be parsed
 * @return parsed text of the remote value
 *
 * input: {"type": "number", "value": 1}
 * output: 1
 *
 * input: {"type": "string", "value": "abc"}
 * output: "abc"
 *
 * input: {"type": "object",  "value": [["id", {"type": "number", "value": 1}]]}
 * output: '{"id": 1}'
 *
 * input: {"type": "object", "value": [["font-size", {"type": "string", "value": "20px"}]]}
 * output: '{"font-size": "20px"}'
 */
function toJson(arg) {
    // arg type validation
    if (arg.type !== 'array' &&
        arg.type !== 'bigint' &&
        arg.type !== 'date' &&
        arg.type !== 'number' &&
        arg.type !== 'object' &&
        arg.type !== 'string') {
        return stringFromArg(arg);
    }
    if (arg.type === 'bigint') {
        return `${arg.value.toString()}n`;
    }
    if (arg.type === 'number') {
        return arg.value.toString();
    }
    if (['date', 'string'].includes(arg.type)) {
        return JSON.stringify(arg.value);
    }
    if (arg.type === 'object') {
        return `{${arg.value
            .map((pair) => {
            return `${JSON.stringify(pair[0])}:${toJson(pair[1])}`;
        })
            .join(',')}}`;
    }
    if (arg.type === 'array') {
        return `[${arg.value?.map((val) => toJson(val)).join(',') ?? ''}]`;
    }
    throw Error(`Invalid value type: ${arg.toString()}`);
}
function stringFromArg(arg) {
    if (!Object.hasOwn(arg, 'value')) {
        return arg.type;
    }
    switch (arg.type) {
        case 'string':
        case 'number':
        case 'boolean':
        case 'bigint':
            return String(arg.value);
        case 'regexp':
            return `/${arg.value.pattern}/${arg.value.flags ?? ''}`;
        case 'date':
            return new Date(arg.value).toString();
        case 'object':
            return `Object(${arg.value?.length ?? ''})`;
        case 'array':
            return `Array(${arg.value?.length ?? ''})`;
        case 'map':
            return `Map(${arg.value.length})`;
        case 'set':
            return `Set(${arg.value.length})`;
        case 'node':
            return 'node';
        default:
            return arg.type;
    }
}
function getRemoteValuesText(args, formatText) {
    const arg = args[0];
    if (!arg) {
        return '';
    }
    // if args[0] is a format specifier, format the args as output
    if (arg.type === 'string' &&
        isFormmatSpecifier(arg.value.toString()) &&
        formatText) {
        return logMessageFormatter(args);
    }
    // if args[0] is not a format specifier, just join the args with \u0020 (unicode 'SPACE')
    return args
        .map((arg) => {
        return stringFromArg(arg);
    })
        .join('\u0020');
}
logHelper.getRemoteValuesText = getRemoteValuesText;

Object.defineProperty(logManager, "__esModule", { value: true });
logManager.LogManager = void 0;
const protocol_js_1$7 = protocol;
const logHelper_js_1 = logHelper;
/** Converts CDP StackTrace object to BiDi StackTrace object. */
function getBidiStackTrace(cdpStackTrace) {
    const stackFrames = cdpStackTrace?.callFrames.map((callFrame) => {
        return {
            columnNumber: callFrame.columnNumber,
            functionName: callFrame.functionName,
            lineNumber: callFrame.lineNumber,
            url: callFrame.url,
        };
    });
    return stackFrames ? { callFrames: stackFrames } : undefined;
}
function getLogLevel(consoleApiType) {
    if (['assert', 'error'].includes(consoleApiType)) {
        return 'error';
    }
    if (['debug', 'trace'].includes(consoleApiType)) {
        return 'debug';
    }
    if (['warn', 'warning'].includes(consoleApiType)) {
        return 'warn';
    }
    return 'info';
}
class LogManager {
    #eventManager;
    #realmStorage;
    #cdpTarget;
    constructor(cdpTarget, realmStorage, eventManager) {
        this.#cdpTarget = cdpTarget;
        this.#realmStorage = realmStorage;
        this.#eventManager = eventManager;
    }
    static create(cdpTarget, realmStorage, eventManager) {
        const logManager = new LogManager(cdpTarget, realmStorage, eventManager);
        logManager.#initialize();
        return logManager;
    }
    #initialize() {
        this.#initializeLogEntryAddedEventListener();
    }
    #initializeLogEntryAddedEventListener() {
        this.#cdpTarget.cdpClient.on('Runtime.consoleAPICalled', (params) => {
            // Try to find realm by `cdpSessionId` and `executionContextId`,
            // if provided.
            const realm = this.#realmStorage.findRealm({
                cdpSessionId: this.#cdpTarget.cdpSessionId,
                executionContextId: params.executionContextId,
            });
            const argsPromise = realm === undefined
                ? Promise.resolve(params.args)
                : // Properly serialize arguments if possible.
                    Promise.all(params.args.map((arg) => {
                        return realm.serializeCdpObject(arg, 'none');
                    }));
            this.#eventManager.registerPromiseEvent(argsPromise.then((args) => ({
                method: protocol_js_1$7.Log.EventNames.LogEntryAddedEvent,
                params: {
                    level: getLogLevel(params.type),
                    source: {
                        realm: realm?.realmId ?? 'UNKNOWN',
                        context: realm?.browsingContextId ?? 'UNKNOWN',
                    },
                    text: (0, logHelper_js_1.getRemoteValuesText)(args, true),
                    timestamp: Math.round(params.timestamp),
                    stackTrace: getBidiStackTrace(params.stackTrace),
                    type: 'console',
                    // Console method is `warn`, not `warning`.
                    method: params.type === 'warning' ? 'warn' : params.type,
                    args,
                },
            })), realm?.browsingContextId ?? 'UNKNOWN', protocol_js_1$7.Log.EventNames.LogEntryAddedEvent);
        });
        this.#cdpTarget.cdpClient.on('Runtime.exceptionThrown', (params) => {
            // Try to find realm by `cdpSessionId` and `executionContextId`,
            // if provided.
            const realm = this.#realmStorage.findRealm({
                cdpSessionId: this.#cdpTarget.cdpSessionId,
                executionContextId: params.exceptionDetails.executionContextId,
            });
            // Try all the best to get the exception text.
            const textPromise = (async () => {
                if (!params.exceptionDetails.exception) {
                    return params.exceptionDetails.text;
                }
                if (realm === undefined) {
                    return JSON.stringify(params.exceptionDetails.exception);
                }
                return realm.stringifyObject(params.exceptionDetails.exception);
            })();
            this.#eventManager.registerPromiseEvent(textPromise.then((text) => ({
                method: protocol_js_1$7.Log.EventNames.LogEntryAddedEvent,
                params: {
                    level: 'error',
                    source: {
                        realm: realm?.realmId ?? 'UNKNOWN',
                        context: realm?.browsingContextId ?? 'UNKNOWN',
                    },
                    text,
                    timestamp: Math.round(params.timestamp),
                    stackTrace: getBidiStackTrace(params.exceptionDetails.stackTrace),
                    type: 'javascript',
                },
            })), realm?.browsingContextId ?? 'UNKNOWN', protocol_js_1$7.Log.EventNames.LogEntryAddedEvent);
        });
    }
}
logManager.LogManager = LogManager;

var networkProcessor = {};

var DefaultMap$1 = {};

/**
 * Copyright 2023 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(DefaultMap$1, "__esModule", { value: true });
DefaultMap$1.DefaultMap = void 0;
/**
 * A subclass of Map whose functionality is almost the same as its parent
 * except for the fact that DefaultMap never returns undefined. It provides a
 * default value for keys that do not exist.
 */
class DefaultMap extends Map {
    /** The default value to return whenever a key is not present in the map. */
    #getDefaultValue;
    constructor(getDefaultValue, entries) {
        super(entries);
        this.#getDefaultValue = getDefaultValue;
    }
    get(key) {
        if (!this.has(key)) {
            this.set(key, this.#getDefaultValue(key));
        }
        return super.get(key);
    }
}
DefaultMap$1.DefaultMap = DefaultMap;

var networkRequest = {};

/*
 * Copyright 2023 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */
Object.defineProperty(networkRequest, "__esModule", { value: true });
networkRequest.NetworkRequest = void 0;
const deferred_js_1$1 = deferred;
const protocol_js_1$6 = protocol;
class NetworkRequest {
    static #unknown = 'UNKNOWN';
    /**
     * Each network request has an associated request id, which is a string
     * uniquely identifying that request.
     *
     * The identifier for a request resulting from a redirect matches that of the
     * request that initiated it.
     */
    requestId;
    #servedFromCache = false;
    #redirectCount;
    #eventManager;
    #requestWillBeSentEvent;
    #requestWillBeSentExtraInfoEvent;
    #responseReceivedEvent;
    #responseReceivedExtraInfoEvent;
    #beforeRequestSentDeferred = new deferred_js_1$1.Deferred();
    #responseReceivedDeferred = new deferred_js_1$1.Deferred();
    constructor(requestId, eventManager) {
        this.requestId = requestId;
        this.#redirectCount = 0;
        this.#eventManager = eventManager;
    }
    onRequestWillBeSentEvent(event) {
        if (this.#requestWillBeSentEvent !== undefined) {
            // TODO: Handle redirect event, requestId is same for the redirect chain
            return;
        }
        this.#requestWillBeSentEvent = event;
        if (this.#requestWillBeSentExtraInfoEvent !== undefined) {
            this.#beforeRequestSentDeferred.resolve();
        }
        this.#sendBeforeRequestEvent();
    }
    onRequestWillBeSentExtraInfoEvent(event) {
        if (this.#requestWillBeSentExtraInfoEvent !== undefined) {
            // TODO: Handle redirect event, requestId is same for the redirect chain
            return;
        }
        this.#requestWillBeSentExtraInfoEvent = event;
        if (this.#requestWillBeSentEvent !== undefined) {
            this.#beforeRequestSentDeferred.resolve();
        }
    }
    onResponseReceivedEventExtraInfo(event) {
        if (this.#responseReceivedExtraInfoEvent !== undefined) {
            // TODO: Handle redirect event, requestId is same for the redirect chain
            return;
        }
        this.#responseReceivedExtraInfoEvent = event;
        if (this.#responseReceivedEvent !== undefined) {
            this.#responseReceivedDeferred.resolve();
        }
    }
    onResponseReceivedEvent(responseReceivedEvent) {
        if (this.#responseReceivedEvent !== undefined) {
            // TODO: Handle redirect event, requestId is same for the redirect chain
            return;
        }
        this.#responseReceivedEvent = responseReceivedEvent;
        if (!responseReceivedEvent.hasExtraInfo &&
            !this.#beforeRequestSentDeferred.isFinished) {
            this.#beforeRequestSentDeferred.resolve();
        }
        if (!responseReceivedEvent.hasExtraInfo ||
            this.#responseReceivedExtraInfoEvent !== undefined ||
            this.#servedFromCache) {
            this.#responseReceivedDeferred.resolve();
        }
        this.#sendResponseReceivedEvent();
    }
    onServedFromCache() {
        if (this.#requestWillBeSentEvent !== undefined) {
            this.#beforeRequestSentDeferred.resolve();
        }
        if (this.#responseReceivedEvent !== undefined) {
            this.#responseReceivedDeferred.resolve();
        }
        this.#servedFromCache = true;
    }
    onLoadingFailedEvent(event) {
        this.#beforeRequestSentDeferred.resolve();
        this.#responseReceivedDeferred.reject(event);
        this.#eventManager.registerEvent({
            method: protocol_js_1$6.Network.EventNames.FetchErrorEvent,
            params: {
                ...this.#getBaseEventParams(),
                errorText: event.errorText,
            },
        }, this.#requestWillBeSentEvent?.frameId ?? null);
    }
    #getBaseEventParams() {
        return {
            context: this.#requestWillBeSentEvent?.frameId ?? null,
            navigation: this.#getNavigationId(),
            // TODO: implement.
            redirectCount: this.#redirectCount,
            request: this.#getRequestData(),
            // Timestamp should be in milliseconds, while CDP provides it in seconds.
            timestamp: Math.round((this.#requestWillBeSentEvent?.wallTime ?? 0) * 1000),
        };
    }
    #getNavigationId() {
        if (!this.#requestWillBeSentEvent ||
            !this.#requestWillBeSentEvent.loaderId ||
            // When we navigate all CDP network events have `loaderId`
            // CDP's `loaderId` and `requestId` match when
            // that request triggered the loading
            this.#requestWillBeSentEvent.loaderId !==
                this.#requestWillBeSentEvent.requestId) {
            return null;
        }
        return this.#requestWillBeSentEvent.loaderId;
    }
    #getRequestData() {
        const cookies = this.#requestWillBeSentExtraInfoEvent
            ? NetworkRequest.#getCookies(this.#requestWillBeSentExtraInfoEvent.associatedCookies)
            : [];
        return {
            request: this.#requestWillBeSentEvent?.requestId ?? NetworkRequest.#unknown,
            url: this.#requestWillBeSentEvent?.request.url ?? NetworkRequest.#unknown,
            method: this.#requestWillBeSentEvent?.request.method ?? NetworkRequest.#unknown,
            headers: NetworkRequest.#getHeaders(this.#requestWillBeSentEvent?.request.headers),
            cookies,
            // TODO: implement.
            headersSize: -1,
            // TODO: implement.
            bodySize: 0,
            timings: {
                // TODO: implement.
                timeOrigin: 0,
                // TODO: implement.
                requestTime: 0,
                // TODO: implement.
                redirectStart: 0,
                // TODO: implement.
                redirectEnd: 0,
                // TODO: implement.
                fetchStart: 0,
                // TODO: implement.
                dnsStart: 0,
                // TODO: implement.
                dnsEnd: 0,
                // TODO: implement.
                connectStart: 0,
                // TODO: implement.
                connectEnd: 0,
                // TODO: implement.
                tlsStart: 0,
                // TODO: implement.
                requestStart: 0,
                // TODO: implement.
                responseStart: 0,
                // TODO: implement.
                responseEnd: 0,
            },
        };
    }
    #sendBeforeRequestEvent() {
        if (!this.#isIgnoredEvent()) {
            this.#eventManager.registerPromiseEvent(this.#beforeRequestSentDeferred.then(() => this.#getBeforeRequestEvent()), this.#requestWillBeSentEvent?.frameId ?? null, protocol_js_1$6.Network.EventNames.BeforeRequestSentEvent);
        }
    }
    #getBeforeRequestEvent() {
        if (this.#requestWillBeSentEvent === undefined) {
            throw new Error('RequestWillBeSentEvent is not set');
        }
        return {
            method: protocol_js_1$6.Network.EventNames.BeforeRequestSentEvent,
            params: {
                ...this.#getBaseEventParams(),
                initiator: {
                    type: NetworkRequest.#getInitiatorType(this.#requestWillBeSentEvent.initiator.type),
                },
            },
        };
    }
    #sendResponseReceivedEvent() {
        if (!this.#isIgnoredEvent()) {
            this.#eventManager.registerPromiseEvent(this.#responseReceivedDeferred.then(() => this.#getResponseReceivedEvent()), this.#responseReceivedEvent?.frameId ?? null, protocol_js_1$6.Network.EventNames.ResponseCompletedEvent);
        }
    }
    #getResponseReceivedEvent() {
        if (this.#requestWillBeSentEvent === undefined) {
            throw new Error('RequestWillBeSentEvent is not set');
        }
        if (this.#responseReceivedEvent === undefined) {
            throw new Error('ResponseReceivedEvent is not set');
        }
        // Chromium sends wrong extraInfo events for responses served from cache.
        // See https://github.com/puppeteer/puppeteer/issues/9965 and
        // https://crbug.com/1340398.
        if (this.#responseReceivedEvent.response.fromDiskCache) {
            this.#responseReceivedExtraInfoEvent = undefined;
        }
        const headers = NetworkRequest.#getHeaders(this.#responseReceivedEvent.response.headers);
        return {
            method: protocol_js_1$6.Network.EventNames.ResponseCompletedEvent,
            params: {
                ...this.#getBaseEventParams(),
                response: {
                    url: this.#responseReceivedEvent.response.url,
                    protocol: this.#responseReceivedEvent.response.protocol ?? '',
                    status: this.#responseReceivedExtraInfoEvent?.statusCode ??
                        this.#responseReceivedEvent.response.status,
                    statusText: this.#responseReceivedEvent.response.statusText,
                    fromCache: this.#responseReceivedEvent.response.fromDiskCache ||
                        this.#responseReceivedEvent.response.fromPrefetchCache ||
                        this.#servedFromCache,
                    headers,
                    mimeType: this.#responseReceivedEvent.response.mimeType,
                    bytesReceived: this.#responseReceivedEvent.response.encodedDataLength,
                    headersSize: this.#computeResponseHeadersSize(headers),
                    // TODO: consider removing from spec.
                    bodySize: 0,
                    content: {
                        // TODO: consider removing from spec.
                        size: 0,
                    },
                },
            },
        };
    }
    #computeResponseHeadersSize(headers) {
        return headers.reduce((total, header) => {
            return total + header.name.length + (header.value?.length ?? 0) + 4; // 4 = ': ' + '\r\n'
        }, 0);
    }
    #isIgnoredEvent() {
        return (this.#requestWillBeSentEvent?.request.url.endsWith('/favicon.ico') ??
            false);
    }
    static #getHeaders(headers) {
        if (!headers) {
            return [];
        }
        return Object.entries(headers).map(([name, value]) => ({
            name,
            value,
        }));
    }
    static #getInitiatorType(initiatorType) {
        switch (initiatorType) {
            case 'parser':
            case 'script':
            case 'preflight':
                return initiatorType;
            default:
                return 'other';
        }
    }
    static #getCookies(associatedCookies) {
        return associatedCookies.map((cookieInfo) => {
            return {
                name: cookieInfo.cookie.name,
                value: cookieInfo.cookie.value,
                domain: cookieInfo.cookie.domain,
                path: cookieInfo.cookie.path,
                expires: cookieInfo.cookie.expires,
                size: cookieInfo.cookie.size,
                httpOnly: cookieInfo.cookie.httpOnly,
                secure: cookieInfo.cookie.secure,
                sameSite: NetworkRequest.#getCookiesSameSite(cookieInfo.cookie.sameSite),
            };
        });
    }
    static #getCookiesSameSite(cdpSameSiteValue) {
        switch (cdpSameSiteValue) {
            case 'Strict':
                return 'strict';
            case 'Lax':
                return 'lax';
            default:
                return 'none';
        }
    }
}
networkRequest.NetworkRequest = NetworkRequest;

/*
 * Copyright 2023 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(networkProcessor, "__esModule", { value: true });
networkProcessor.NetworkProcessor = void 0;
const DefaultMap_js_1$1 = DefaultMap$1;
const networkRequest_js_1 = networkRequest;
class NetworkProcessor {
    #eventManager;
    /**
     * Map of request ID to NetworkRequest objects. Needed as long as information
     * about requests comes from different events.
     */
    #requestMap;
    constructor(eventManager) {
        this.#eventManager = eventManager;
        this.#requestMap = new DefaultMap_js_1$1.DefaultMap((requestId) => new networkRequest_js_1.NetworkRequest(requestId, this.#eventManager));
    }
    static async create(cdpClient, eventManager) {
        const networkProcessor = new NetworkProcessor(eventManager);
        cdpClient.on('Network.requestWillBeSent', (params) => {
            networkProcessor
                .#getOrCreateNetworkRequest(params.requestId)
                .onRequestWillBeSentEvent(params);
        });
        cdpClient.on('Network.requestWillBeSentExtraInfo', (params) => {
            networkProcessor
                .#getOrCreateNetworkRequest(params.requestId)
                .onRequestWillBeSentExtraInfoEvent(params);
        });
        cdpClient.on('Network.responseReceived', (params) => {
            networkProcessor
                .#getOrCreateNetworkRequest(params.requestId)
                .onResponseReceivedEvent(params);
        });
        cdpClient.on('Network.responseReceivedExtraInfo', (params) => {
            networkProcessor
                .#getOrCreateNetworkRequest(params.requestId)
                .onResponseReceivedEventExtraInfo(params);
        });
        cdpClient.on('Network.loadingFailed', (params) => {
            networkProcessor
                .#getOrCreateNetworkRequest(params.requestId)
                .onLoadingFailedEvent(params);
        });
        cdpClient.on('Network.requestServedFromCache', (params) => {
            networkProcessor
                .#getOrCreateNetworkRequest(params.requestId)
                .onServedFromCache();
        });
        await cdpClient.sendCommand('Network.enable');
        return networkProcessor;
    }
    #getOrCreateNetworkRequest(requestId) {
        return this.#requestMap.get(requestId);
    }
}
networkProcessor.NetworkProcessor = NetworkProcessor;

Object.defineProperty(cdpTarget, "__esModule", { value: true });
cdpTarget.CdpTarget = void 0;
const logManager_js_1 = logManager;
const deferred_js_1 = deferred;
const networkProcessor_js_1 = networkProcessor;
class CdpTarget {
    #targetId;
    #parentTargetId;
    #cdpClient;
    #cdpSessionId;
    #eventManager;
    #preloadScriptStorage;
    #targetUnblocked;
    #networkDomainActivated;
    static create(targetId, parentTargetId, cdpClient, cdpSessionId, realmStorage, eventManager, preloadScriptStorage) {
        const cdpTarget = new CdpTarget(targetId, parentTargetId, cdpClient, cdpSessionId, eventManager, preloadScriptStorage);
        logManager_js_1.LogManager.create(cdpTarget, realmStorage, eventManager);
        cdpTarget.#setEventListeners();
        // No need to await.
        // Deferred will be resolved when the target is unblocked.
        void cdpTarget.#unblock();
        return cdpTarget;
    }
    constructor(targetId, parentTargetId, cdpClient, cdpSessionId, eventManager, preloadScriptStorage) {
        this.#targetId = targetId;
        this.#parentTargetId = parentTargetId;
        this.#cdpClient = cdpClient;
        this.#cdpSessionId = cdpSessionId;
        this.#eventManager = eventManager;
        this.#preloadScriptStorage = preloadScriptStorage;
        this.#networkDomainActivated = false;
        this.#targetUnblocked = new deferred_js_1.Deferred();
    }
    /** Returns a promise that resolves when the target is unblocked. */
    get targetUnblocked() {
        return this.#targetUnblocked;
    }
    get targetId() {
        return this.#targetId;
    }
    get cdpClient() {
        return this.#cdpClient;
    }
    /**
     * Needed for CDP escape path.
     */
    get cdpSessionId() {
        return this.#cdpSessionId;
    }
    /**
     * Enables all the required CDP domains and unblocks the target.
     */
    async #unblock() {
        try {
            // Enable Network domain, if it is enabled globally.
            // TODO: enable Network domain for OOPiF targets.
            if (this.#eventManager.isNetworkDomainEnabled) {
                await this.enableNetworkDomain();
            }
            await this.#cdpClient.sendCommand('Runtime.enable');
            await this.#cdpClient.sendCommand('Page.enable');
            await this.#cdpClient.sendCommand('Page.setLifecycleEventsEnabled', {
                enabled: true,
            });
            await this.#cdpClient.sendCommand('Target.setAutoAttach', {
                autoAttach: true,
                waitForDebuggerOnStart: true,
                flatten: true,
            });
            await this.#initAndEvaluatePreloadScripts();
            await this.#cdpClient.sendCommand('Runtime.runIfWaitingForDebugger');
        }
        catch (error) {
            // The target might have been closed before the initialization finished.
            if (!this.#cdpClient.isCloseError(error)) {
                throw error;
            }
        }
        this.#targetUnblocked.resolve();
    }
    /**
     * Enables the Network domain (creates NetworkProcessor on the target's cdp
     * client) if it is not enabled yet.
     */
    async enableNetworkDomain() {
        if (!this.#networkDomainActivated) {
            this.#networkDomainActivated = true;
            await networkProcessor_js_1.NetworkProcessor.create(this.cdpClient, this.#eventManager);
        }
    }
    #setEventListeners() {
        this.#cdpClient.on('*', (event, params) => {
            // We may encounter uses for EventEmitter other than CDP events,
            // which we want to skip.
            if (typeof event !== 'string') {
                return;
            }
            this.#eventManager.registerEvent({
                method: `cdp.${event}`,
                params: {
                    event,
                    params: params,
                    session: this.#cdpSessionId,
                },
            }, null);
        });
    }
    /**
     * All the ProxyChannels from all the preload scripts of the given
     * BrowsingContext.
     */
    getChannels(contextId) {
        return this.#preloadScriptStorage
            .findPreloadScripts({
            contextIds: [null, contextId],
        })
            .flatMap((script) => script.channels);
    }
    /** Loads all top-level and parent preload scripts. */
    async #initAndEvaluatePreloadScripts() {
        for (const script of this.#preloadScriptStorage.findPreloadScripts({
            contextIds: [null, this.#parentTargetId],
        })) {
            await script.initInTarget(this);
            // Upon attaching to a new target, schedule running preload scripts right
            // after `Runtime.runIfWaitingForDebugger`, but don't wait for the result.
            script.scheduleEvaluateInTarget(this);
        }
    }
}
cdpTarget.CdpTarget = CdpTarget;

var bidiPreloadScript = {};

/*
 * Copyright 2023 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */
Object.defineProperty(bidiPreloadScript, "__esModule", { value: true });
bidiPreloadScript.BidiPreloadScript = void 0;
const uuid_js_1 = uuid;
const channelProxy_js_1 = channelProxy;
/**
 * BiDi IDs are generated by the server and are unique within the context.
 *
 * CDP preload script IDs are generated by the client and are unique
 * within the session.
 *
 * The mapping between BiDi and CDP preload script IDs is 1:many.
 * BiDi IDs are needed by the mapper to keep track of potential multiple CDP IDs
 * in the client.
 */
class BidiPreloadScript {
    /** BiDi ID, an automatically generated UUID. */
    #id = (0, uuid_js_1.uuidv4)();
    /** CDP preload scripts. */
    #cdpPreloadScripts = [];
    /** The script itself, in a format expected by the spec i.e. a function. */
    #functionDeclaration;
    /** Browsing context ID. */
    #contextId;
    /** Targets, in which the preload script is initialized. */
    #targetIds = new Set();
    /** Channels to be added as arguments to functionDeclaration. */
    #channels;
    get id() {
        return this.#id;
    }
    get contextId() {
        return this.#contextId;
    }
    get targetIds() {
        return this.#targetIds;
    }
    constructor(params) {
        if (params.sandbox !== undefined) {
            // TODO: Handle sandbox.
            throw new Error('Sandbox is not supported yet');
        }
        this.#channels =
            params.arguments?.map((a) => new channelProxy_js_1.ChannelProxy(a.value)) ?? [];
        this.#functionDeclaration = params.functionDeclaration;
        this.#contextId = params.context ?? null;
    }
    /** Channels of the preload script. */
    get channels() {
        return this.#channels;
    }
    /**
     * Adds the script to the given CDP targets by calling the
     * `Page.addScriptToEvaluateOnNewDocument` command.
     */
    async initInTargets(cdpTargets) {
        await Promise.all(Array.from(cdpTargets).map((cdpTarget) => this.initInTarget(cdpTarget)));
    }
    /**
     * String to be evaluated. Wraps user-provided function so that the following
     * steps are run:
     * 1. Create channels.
     * 2. Store the created channels in window.
     * 3. Call the user-provided function with channels as arguments.
     */
    #getEvaluateString() {
        const channelsArgStr = `[${this.channels
            .map((c) => c.getEvalInWindowStr())
            .join(', ')}]`;
        return `(()=>{(${this.#functionDeclaration})(...${channelsArgStr})})()`;
    }
    /**
     * Adds the script to the given CDP target by calling the
     * `Page.addScriptToEvaluateOnNewDocument` command.
     */
    async initInTarget(cdpTarget) {
        const addCdpPreloadScriptResult = await cdpTarget.cdpClient.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
            source: this.#getEvaluateString(),
        });
        this.#cdpPreloadScripts.push({
            target: cdpTarget,
            preloadScriptId: addCdpPreloadScriptResult.identifier,
        });
        this.#targetIds.add(cdpTarget.targetId);
    }
    /**
     * Schedules the script to be run right after
     * `Runtime.runIfWaitingForDebugger`, but does not wait for result.
     */
    scheduleEvaluateInTarget(cdpTarget) {
        void cdpTarget.cdpClient.sendCommand('Runtime.evaluate', {
            expression: this.#getEvaluateString(),
        });
    }
    /**
     * Removes this script from all CDP targets.
     */
    async remove() {
        for (const cdpPreloadScript of this.#cdpPreloadScripts) {
            const cdpTarget = cdpPreloadScript.target;
            const cdpPreloadScriptId = cdpPreloadScript.preloadScriptId;
            await cdpTarget.cdpClient.sendCommand('Page.removeScriptToEvaluateOnNewDocument', {
                identifier: cdpPreloadScriptId,
            });
        }
    }
    /**
     * Removes the provided cdp target from the list of cdp preload scripts.
     */
    cdpTargetIsGone(cdpTargetId) {
        this.#cdpPreloadScripts = this.#cdpPreloadScripts.filter((cdpPreloadScript) => cdpPreloadScript.target?.targetId !== cdpTargetId);
        this.#targetIds.delete(cdpTargetId);
    }
}
bidiPreloadScript.BidiPreloadScript = BidiPreloadScript;

Object.defineProperty(browsingContextProcessor, "__esModule", { value: true });
browsingContextProcessor.BrowsingContextProcessor = void 0;
const protocol_js_1$5 = protocol;
const log_js_1$2 = log;
const InputStateManager_js_1 = InputStateManager$1;
const ActionDispatcher_js_1 = ActionDispatcher$1;
const PreloadScriptStorage_js_1 = PreloadScriptStorage$1;
const browsingContextImpl_js_1 = browsingContextImpl;
const cdpTarget_js_1 = cdpTarget;
const bidiPreloadScript_1 = bidiPreloadScript;
class BrowsingContextProcessor {
    #browsingContextStorage;
    #cdpConnection;
    #eventManager;
    #logger;
    #realmStorage;
    #selfTargetId;
    #preloadScriptStorage = new PreloadScriptStorage_js_1.PreloadScriptStorage();
    #inputStateManager = new InputStateManager_js_1.InputStateManager();
    constructor(cdpConnection, selfTargetId, eventManager, browsingContextStorage, realmStorage, logger) {
        this.#cdpConnection = cdpConnection;
        this.#selfTargetId = selfTargetId;
        this.#eventManager = eventManager;
        this.#browsingContextStorage = browsingContextStorage;
        this.#realmStorage = realmStorage;
        this.#logger = logger;
        this.#setEventListeners(this.#cdpConnection.browserClient());
    }
    /**
     * This method is called for each CDP session, since this class is responsible
     * for creating and destroying all targets and browsing contexts.
     */
    #setEventListeners(cdpClient) {
        cdpClient.on('Target.attachedToTarget', (params) => {
            this.#handleAttachedToTargetEvent(params, cdpClient);
        });
        cdpClient.on('Target.detachedFromTarget', (params) => {
            this.#handleDetachedFromTargetEvent(params);
        });
        cdpClient.on('Target.targetInfoChanged', (params) => {
            this.#handleTargetInfoChangedEvent(params);
        });
        cdpClient.on('Page.frameAttached', (params) => {
            this.#handleFrameAttachedEvent(params);
        });
        cdpClient.on('Page.frameDetached', (params) => {
            this.#handleFrameDetachedEvent(params);
        });
    }
    #handleFrameAttachedEvent(params) {
        const parentBrowsingContext = this.#browsingContextStorage.findContext(params.parentFrameId);
        if (parentBrowsingContext !== undefined) {
            browsingContextImpl_js_1.BrowsingContextImpl.create(parentBrowsingContext.cdpTarget, this.#realmStorage, params.frameId, params.parentFrameId, this.#eventManager, this.#browsingContextStorage, this.#logger);
        }
    }
    #handleFrameDetachedEvent(params) {
        // In case of OOPiF no need in deleting BrowsingContext.
        if (params.reason === 'swap') {
            return;
        }
        this.#browsingContextStorage.findContext(params.frameId)?.delete();
    }
    #handleAttachedToTargetEvent(params, parentSessionCdpClient) {
        const { sessionId, targetInfo } = params;
        const targetCdpClient = this.#cdpConnection.getCdpClient(sessionId);
        if (!this.#isValidTarget(targetInfo)) {
            // DevTools or some other not supported by BiDi target. Just release
            // debugger  and ignore them.
            targetCdpClient
                .sendCommand('Runtime.runIfWaitingForDebugger')
                .then(() => parentSessionCdpClient.sendCommand('Target.detachFromTarget', params))
                .catch((error) => this.#logger?.(log_js_1$2.LogType.system, error));
            return;
        }
        this.#logger?.(log_js_1$2.LogType.browsingContexts, 'AttachedToTarget event received:', JSON.stringify(params, null, 2));
        this.#setEventListeners(targetCdpClient);
        const maybeContext = this.#browsingContextStorage.findContext(targetInfo.targetId);
        const cdpTarget = cdpTarget_js_1.CdpTarget.create(targetInfo.targetId, maybeContext?.parentId ?? null, targetCdpClient, sessionId, this.#realmStorage, this.#eventManager, this.#preloadScriptStorage);
        if (maybeContext) {
            // OOPiF.
            maybeContext.updateCdpTarget(cdpTarget);
        }
        else {
            // New context.
            browsingContextImpl_js_1.BrowsingContextImpl.create(cdpTarget, this.#realmStorage, targetInfo.targetId, null, this.#eventManager, this.#browsingContextStorage, this.#logger);
        }
    }
    #handleDetachedFromTargetEvent(params) {
        // XXX: params.targetId is deprecated. Update this class to track using
        // params.sessionId instead.
        // https://github.com/GoogleChromeLabs/chromium-bidi/issues/60
        const contextId = params.targetId;
        this.#browsingContextStorage.findContext(contextId)?.delete();
        this.#preloadScriptStorage
            .findPreloadScripts({ targetId: contextId })
            .map((preloadScript) => preloadScript.cdpTargetIsGone(contextId));
    }
    #handleTargetInfoChangedEvent(params) {
        const contextId = params.targetInfo.targetId;
        this.#browsingContextStorage
            .findContext(contextId)
            ?.onTargetInfoChanged(params);
    }
    async #getRealm(target) {
        if ('realm' in target) {
            return this.#realmStorage.getRealm({
                realmId: target.realm,
            });
        }
        const context = this.#browsingContextStorage.getContext(target.context);
        return context.getOrCreateSandbox(target.sandbox);
    }
    process_browsingContext_getTree(params) {
        const resultContexts = params.root === undefined
            ? this.#browsingContextStorage.getTopLevelContexts()
            : [this.#browsingContextStorage.getContext(params.root)];
        return {
            result: {
                contexts: resultContexts.map((c) => c.serializeToBidiValue(params.maxDepth ?? Number.MAX_VALUE)),
            },
        };
    }
    async process_browsingContext_create(params) {
        const browserCdpClient = this.#cdpConnection.browserClient();
        let referenceContext;
        if (params.referenceContext !== undefined) {
            referenceContext = this.#browsingContextStorage.getContext(params.referenceContext);
            if (!referenceContext.isTopLevelContext()) {
                throw new protocol_js_1$5.Message.InvalidArgumentException(`referenceContext should be a top-level context`);
            }
        }
        let result;
        switch (params.type) {
            case 'tab':
                result = await browserCdpClient.sendCommand('Target.createTarget', {
                    url: 'about:blank',
                    newWindow: false,
                });
                break;
            case 'window':
                result = await browserCdpClient.sendCommand('Target.createTarget', {
                    url: 'about:blank',
                    newWindow: true,
                });
                break;
        }
        // Wait for the new tab to be loaded to avoid race conditions in the
        // `browsingContext` events, when the `browsingContext.domContentLoaded` and
        // `browsingContext.load` events from the initial `about:blank` navigation
        // are emitted after the next navigation is started.
        // Details: https://github.com/web-platform-tests/wpt/issues/35846
        const contextId = result.targetId;
        const context = this.#browsingContextStorage.getContext(contextId);
        await context.awaitLoaded();
        return {
            result: {
                context: context.id,
            },
        };
    }
    process_browsingContext_navigate(params) {
        const context = this.#browsingContextStorage.getContext(params.context);
        return context.navigate(params.url, params.wait ?? 'none');
    }
    process_browsingContext_reload(params) {
        const context = this.#browsingContextStorage.getContext(params.context);
        return context.reload(params.ignoreCache ?? false, params.wait ?? 'none');
    }
    async process_browsingContext_captureScreenshot(params) {
        const context = this.#browsingContextStorage.getContext(params.context);
        return context.captureScreenshot();
    }
    async process_browsingContext_print(params) {
        const context = this.#browsingContextStorage.getContext(params.context);
        return context.print(params);
    }
    async process_script_addPreloadScript(params) {
        const preloadScript = new bidiPreloadScript_1.BidiPreloadScript(params);
        this.#preloadScriptStorage.addPreloadScript(preloadScript);
        const cdpTargets = new Set(
        // TODO: The unique target can be in a non-top-level browsing context.
        // We need all the targets.
        // To get them, we can walk through all the contexts and collect their targets into the set.
        params.context === undefined || params.context === null
            ? this.#browsingContextStorage
                .getTopLevelContexts()
                .map((context) => context.cdpTarget)
            : [this.#browsingContextStorage.getContext(params.context).cdpTarget]);
        await preloadScript.initInTargets(cdpTargets);
        return {
            result: {
                script: preloadScript.id,
            },
        };
    }
    async process_script_removePreloadScript(params) {
        const bidiId = params.script;
        const scripts = this.#preloadScriptStorage.findPreloadScripts({
            id: bidiId,
        });
        if (scripts.length === 0) {
            throw new protocol_js_1$5.Message.NoSuchScriptException(`No preload script with BiDi ID '${bidiId}'`);
        }
        await Promise.all(scripts.map((script) => script.remove()));
        this.#preloadScriptStorage.removeBiDiPreloadScripts({
            id: bidiId,
        });
        return { result: {} };
    }
    async process_script_evaluate(params) {
        const realm = await this.#getRealm(params.target);
        return realm.scriptEvaluate(params.expression, params.awaitPromise, params.resultOwnership ?? 'none', params.serializationOptions ?? {});
    }
    process_script_getRealms(params) {
        if (params.context !== undefined) {
            // Make sure the context is known.
            this.#browsingContextStorage.getContext(params.context);
        }
        const realms = this.#realmStorage
            .findRealms({
            browsingContextId: params.context,
            type: params.type,
        })
            .map((realm) => realm.toBiDi());
        return { result: { realms } };
    }
    async process_script_callFunction(params) {
        const realm = await this.#getRealm(params.target);
        return realm.callFunction(params.functionDeclaration, params.this ?? {
            type: 'undefined',
        }, // `this` is `undefined` by default.
        params.arguments ?? [], // `arguments` is `[]` by default.
        params.awaitPromise, params.resultOwnership ?? 'none', params.serializationOptions ?? {});
    }
    async process_script_disown(params) {
        const realm = await this.#getRealm(params.target);
        await Promise.all(params.handles.map(async (h) => realm.disown(h)));
        return { result: {} };
    }
    async process_input_performActions(params) {
        const context = this.#browsingContextStorage.getContext(params.context);
        const inputState = this.#inputStateManager.get(context.top);
        const actionsByTick = this.#getActionsByTick(params, inputState);
        const dispatcher = new ActionDispatcher_js_1.ActionDispatcher(inputState, context, await ActionDispatcher_js_1.ActionDispatcher.isMacOS(context).catch(() => false));
        await dispatcher.dispatchActions(actionsByTick);
        return { result: {} };
    }
    #getActionsByTick(params, inputState) {
        const actionsByTick = [];
        for (const action of params.actions) {
            switch (action.type) {
                case protocol_js_1$5.Input.SourceActionsType.Pointer: {
                    action.parameters ??= { pointerType: protocol_js_1$5.Input.PointerType.Mouse };
                    action.parameters.pointerType ??= protocol_js_1$5.Input.PointerType.Mouse;
                    const source = inputState.getOrCreate(action.id, protocol_js_1$5.Input.SourceActionsType.Pointer, action.parameters.pointerType);
                    if (source.subtype !== action.parameters.pointerType) {
                        throw new protocol_js_1$5.Message.InvalidArgumentException(`Expected input source ${action.id} to be ${source.subtype}; got ${action.parameters.pointerType}.`);
                    }
                    break;
                }
                default:
                    inputState.getOrCreate(action.id, action.type);
            }
            const actions = action.actions.map((item) => ({
                id: action.id,
                action: item,
            }));
            for (let i = 0; i < actions.length; i++) {
                if (actionsByTick.length === i) {
                    actionsByTick.push([]);
                }
                actionsByTick[i].push(actions[i]);
            }
        }
        return actionsByTick;
    }
    async process_input_releaseActions(params) {
        const context = this.#browsingContextStorage.getContext(params.context);
        const topContext = context.top;
        const inputState = this.#inputStateManager.get(topContext);
        const dispatcher = new ActionDispatcher_js_1.ActionDispatcher(inputState, context, await ActionDispatcher_js_1.ActionDispatcher.isMacOS(context).catch(() => false));
        await dispatcher.dispatchTickActions(inputState.cancelList.reverse());
        this.#inputStateManager.delete(topContext);
        return { result: {} };
    }
    async process_browsingContext_setViewport(params) {
        const context = this.#browsingContextStorage.getContext(params.context);
        if (!context.isTopLevelContext()) {
            throw new protocol_js_1$5.Message.InvalidArgumentException('Emulating viewport is only supported on the top-level context');
        }
        await context.setViewport(params.viewport);
        return { result: {} };
    }
    async process_browsingContext_close(commandParams) {
        const browserCdpClient = this.#cdpConnection.browserClient();
        const context = this.#browsingContextStorage.getContext(commandParams.context);
        if (!context.isTopLevelContext()) {
            throw new protocol_js_1$5.Message.InvalidArgumentException('A top-level browsing context cannot be closed.');
        }
        const detachedFromTargetPromise = new Promise((resolve) => {
            const onContextDestroyed = (eventParams) => {
                if (eventParams.targetId === commandParams.context) {
                    browserCdpClient.off('Target.detachedFromTarget', onContextDestroyed);
                    resolve();
                }
            };
            browserCdpClient.on('Target.detachedFromTarget', onContextDestroyed);
        });
        await browserCdpClient.sendCommand('Target.closeTarget', {
            targetId: commandParams.context,
        });
        // Sometimes CDP command finishes before `detachedFromTarget` event,
        // sometimes after. Wait for the CDP command to be finished, and then wait
        // for `detachedFromTarget` if it hasn't emitted.
        await detachedFromTargetPromise;
        return { result: {} };
    }
    #isValidTarget(target) {
        if (target.targetId === this.#selfTargetId) {
            return false;
        }
        return ['page', 'iframe'].includes(target.type);
    }
    async process_cdp_sendCommand(params) {
        const client = params.session
            ? this.#cdpConnection.getCdpClient(params.session)
            : this.#cdpConnection.browserClient();
        const sendCdpCommandResult = await client.sendCommand(params.method, params.params);
        return {
            result: sendCdpCommandResult,
            session: params.session,
        };
    }
    process_cdp_getSession(params) {
        const context = params.context;
        const sessionId = this.#browsingContextStorage.getContext(context).cdpTarget.cdpSessionId;
        if (sessionId === undefined) {
            return { result: { session: null } };
        }
        return { result: { session: sessionId } };
    }
}
browsingContextProcessor.BrowsingContextProcessor = BrowsingContextProcessor;

var OutgoingBidiMessage$1 = {};

/**
 * Copyright 2021 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(OutgoingBidiMessage$1, "__esModule", { value: true });
OutgoingBidiMessage$1.OutgoingBidiMessage = void 0;
class OutgoingBidiMessage {
    #message;
    #channel;
    constructor(message, channel) {
        this.#message = message;
        this.#channel = channel;
    }
    static async createFromPromise(messagePromise, channel) {
        return messagePromise.then((message) => new OutgoingBidiMessage(message, channel));
    }
    static createResolved(message, channel) {
        return Promise.resolve(new OutgoingBidiMessage(message, channel));
    }
    get message() {
        return this.#message;
    }
    get channel() {
        return this.#channel;
    }
}
OutgoingBidiMessage$1.OutgoingBidiMessage = OutgoingBidiMessage;

/**
 * Copyright 2021 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(CommandProcessor$1, "__esModule", { value: true });
CommandProcessor$1.CommandProcessor = void 0;
const protocol_js_1$4 = protocol;
const log_js_1$1 = log;
const EventEmitter_js_1$1 = EventEmitter$1;
const browsingContextProcessor_js_1 = browsingContextProcessor;
const OutgoingBidiMessage_js_1$1 = OutgoingBidiMessage$1;
class BidiNoOpParser {
    parseAddPreloadScriptParams(params) {
        return params;
    }
    parseRemovePreloadScriptParams(params) {
        return params;
    }
    parseGetRealmsParams(params) {
        return params;
    }
    parseCallFunctionParams(params) {
        return params;
    }
    parseEvaluateParams(params) {
        return params;
    }
    parseDisownParams(params) {
        return params;
    }
    parseSendCommandParams(params) {
        return params;
    }
    parseGetSessionParams(params) {
        return params;
    }
    parseSubscribeParams(params) {
        return params;
    }
    parseNavigateParams(params) {
        return params;
    }
    parseReloadParams(params) {
        return params;
    }
    parseGetTreeParams(params) {
        return params;
    }
    parseCreateParams(params) {
        return params;
    }
    parseCloseParams(params) {
        return params;
    }
    parseCaptureScreenshotParams(params) {
        return params;
    }
    parsePrintParams(params) {
        return params;
    }
    parsePerformActionsParams(params) {
        return params;
    }
    parseReleaseActionsParams(params) {
        return params;
    }
    parseSetViewportParams(params) {
        return params;
    }
}
class CommandProcessor extends EventEmitter_js_1$1.EventEmitter {
    #contextProcessor;
    #eventManager;
    #parser;
    #logger;
    constructor(cdpConnection, eventManager, selfTargetId, parser = new BidiNoOpParser(), browsingContextStorage, realmStorage, logger) {
        super();
        this.#eventManager = eventManager;
        this.#logger = logger;
        this.#contextProcessor = new browsingContextProcessor_js_1.BrowsingContextProcessor(cdpConnection, selfTargetId, eventManager, browsingContextStorage, realmStorage, logger);
        this.#parser = parser;
    }
    static #process_session_status() {
        return { result: { ready: false, message: 'already connected' } };
    }
    async #process_session_subscribe(params, channel) {
        await this.#eventManager.subscribe(params.events, params.contexts ?? [null], channel);
        return { result: {} };
    }
    async #process_session_unsubscribe(params, channel) {
        await this.#eventManager.unsubscribe(params.events, params.contexts ?? [null], channel);
        return { result: {} };
    }
    async #processCommand(commandData) {
        switch (commandData.method) {
            case 'session.status':
                return CommandProcessor.#process_session_status();
            case 'session.subscribe':
                return this.#process_session_subscribe(this.#parser.parseSubscribeParams(commandData.params), commandData.channel ?? null);
            case 'session.unsubscribe':
                return this.#process_session_unsubscribe(this.#parser.parseSubscribeParams(commandData.params), commandData.channel ?? null);
            case 'browsingContext.create':
                return this.#contextProcessor.process_browsingContext_create(this.#parser.parseCreateParams(commandData.params));
            case 'browsingContext.close':
                return this.#contextProcessor.process_browsingContext_close(this.#parser.parseCloseParams(commandData.params));
            case 'browsingContext.getTree':
                return this.#contextProcessor.process_browsingContext_getTree(this.#parser.parseGetTreeParams(commandData.params));
            case 'browsingContext.navigate':
                return this.#contextProcessor.process_browsingContext_navigate(this.#parser.parseNavigateParams(commandData.params));
            case 'browsingContext.captureScreenshot':
                return this.#contextProcessor.process_browsingContext_captureScreenshot(this.#parser.parseCaptureScreenshotParams(commandData.params));
            case 'browsingContext.print':
                return this.#contextProcessor.process_browsingContext_print(this.#parser.parsePrintParams(commandData.params));
            case 'browsingContext.reload':
                return this.#contextProcessor.process_browsingContext_reload(this.#parser.parseReloadParams(commandData.params));
            case 'browsingContext.setViewport':
                return this.#contextProcessor.process_browsingContext_setViewport(this.#parser.parseSetViewportParams(commandData.params));
            case 'script.addPreloadScript':
                return this.#contextProcessor.process_script_addPreloadScript(this.#parser.parseAddPreloadScriptParams(commandData.params));
            case 'script.removePreloadScript':
                return this.#contextProcessor.process_script_removePreloadScript(this.#parser.parseRemovePreloadScriptParams(commandData.params));
            case 'script.getRealms':
                return this.#contextProcessor.process_script_getRealms(this.#parser.parseGetRealmsParams(commandData.params));
            case 'script.callFunction':
                return this.#contextProcessor.process_script_callFunction(this.#parser.parseCallFunctionParams(commandData.params));
            case 'script.evaluate':
                return this.#contextProcessor.process_script_evaluate(this.#parser.parseEvaluateParams(commandData.params));
            case 'script.disown':
                return this.#contextProcessor.process_script_disown(this.#parser.parseDisownParams(commandData.params));
            case 'input.performActions':
                return this.#contextProcessor.process_input_performActions(this.#parser.parsePerformActionsParams(commandData.params));
            case 'input.releaseActions':
                return this.#contextProcessor.process_input_releaseActions(this.#parser.parseReleaseActionsParams(commandData.params));
            case 'cdp.sendCommand':
                return this.#contextProcessor.process_cdp_sendCommand(this.#parser.parseSendCommandParams(commandData.params));
            case 'cdp.getSession':
                return this.#contextProcessor.process_cdp_getSession(this.#parser.parseGetSessionParams(commandData.params));
        }
        // Intentionally kept outside of the switch statement to ensure that
        // ESLint @typescript-eslint/switch-exhaustiveness-check triggers if a new
        // command is added.
        throw new protocol_js_1$4.Message.UnknownCommandException(`Unknown command '${commandData.method}'.`);
    }
    async processCommand(command) {
        try {
            const result = await this.#processCommand(command);
            const response = {
                id: command.id,
                ...result,
            };
            this.emit('response', OutgoingBidiMessage_js_1$1.OutgoingBidiMessage.createResolved(response, command.channel ?? null));
        }
        catch (e) {
            if (e instanceof protocol_js_1$4.Message.ErrorResponse) {
                const errorResponse = e;
                this.emit('response', OutgoingBidiMessage_js_1$1.OutgoingBidiMessage.createResolved(errorResponse.toErrorResponse(command.id), command.channel ?? null));
            }
            else {
                const error = e;
                this.#logger?.(log_js_1$1.LogType.bidi, error);
                this.emit('response', OutgoingBidiMessage_js_1$1.OutgoingBidiMessage.createResolved(new protocol_js_1$4.Message.UnknownErrorException(error.message).toErrorResponse(command.id), command.channel ?? null));
            }
        }
    }
}
CommandProcessor$1.CommandProcessor = CommandProcessor;

var browsingContextStorage = {};

/**
 * Copyright 2022 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(browsingContextStorage, "__esModule", { value: true });
browsingContextStorage.BrowsingContextStorage = void 0;
const protocol_js_1$3 = protocol;
/** Container class for browsing contexts. */
class BrowsingContextStorage {
    /** Map from context ID to context implementation. */
    #contexts = new Map();
    /** Gets all top-level contexts, i.e. those with no parent. */
    getTopLevelContexts() {
        return this.getAllContexts().filter((context) => context.isTopLevelContext());
    }
    /** Gets all contexts. */
    getAllContexts() {
        return Array.from(this.#contexts.values());
    }
    /** Deletes the context with the given ID. */
    deleteContextById(id) {
        this.#contexts.delete(id);
    }
    /** Deletes the given context. */
    deleteContext(context) {
        this.#contexts.delete(context.id);
    }
    /** Tracks the given context. */
    addContext(context) {
        this.#contexts.set(context.id, context);
    }
    /** Returns true whether there is an existing context with the given ID. */
    hasContext(id) {
        return this.#contexts.has(id);
    }
    /** Gets the context with the given ID, if any. */
    findContext(id) {
        return this.#contexts.get(id);
    }
    /** Returns the top-level context ID of the given context, if any. */
    findTopLevelContextId(id) {
        if (id === null) {
            return null;
        }
        const maybeContext = this.findContext(id);
        const parentId = maybeContext?.parentId ?? null;
        if (parentId === null) {
            return id;
        }
        return this.findTopLevelContextId(parentId);
    }
    /** Gets the context with the given ID, if any, otherwise throws. */
    getContext(id) {
        const result = this.findContext(id);
        if (result === undefined) {
            throw new protocol_js_1$3.Message.NoSuchFrameException(`Context ${id} not found`);
        }
        return result;
    }
}
browsingContextStorage.BrowsingContextStorage = BrowsingContextStorage;

var EventManager$1 = {};

var buffer = {};

/**
 * Copyright 2022 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(buffer, "__esModule", { value: true });
buffer.Buffer = void 0;
/**
 * Implements a FIFO buffer with a fixed size.
 */
let Buffer$1 = class Buffer {
    #capacity;
    #entries = [];
    #onItemRemoved;
    /**
     * @param capacity
     * @param onItemRemoved optional delegate called for each removed element.
     */
    constructor(capacity, onItemRemoved) {
        this.#capacity = capacity;
        this.#onItemRemoved = onItemRemoved;
    }
    get() {
        return this.#entries;
    }
    add(value) {
        this.#entries.push(value);
        while (this.#entries.length > this.#capacity) {
            const item = this.#entries.shift();
            if (item !== undefined) {
                this.#onItemRemoved?.(item);
            }
        }
    }
};
buffer.Buffer = Buffer$1;

var idWrapper = {};

/**
 * Copyright 2022 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(idWrapper, "__esModule", { value: true });
idWrapper.IdWrapper = void 0;
/**
 * Creates an object with a positive unique incrementing id.
 */
class IdWrapper {
    static #counter = 0;
    #id;
    constructor() {
        this.#id = ++IdWrapper.#counter;
    }
    get id() {
        return this.#id;
    }
}
idWrapper.IdWrapper = IdWrapper;

var SubscriptionManager$1 = {};

/**
 * Copyright 2022 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(SubscriptionManager$1, "__esModule", { value: true });
SubscriptionManager$1.SubscriptionManager = SubscriptionManager$1.unrollEvents = SubscriptionManager$1.cartesianProduct = void 0;
const protocol_js_1$2 = protocol;
/**
 * Returns the cartesian product of the given arrays.
 *
 * Example:
 *   cartesian([1, 2], ['a', 'b']); => [[1, 'a'], [1, 'b'], [2, 'a'], [2, 'b']]
 */
function cartesianProduct(...a) {
    return a.reduce((a, b) => a.flatMap((d) => b.map((e) => [d, e].flat())));
}
SubscriptionManager$1.cartesianProduct = cartesianProduct;
/** Expands "AllEvents" events into atomic events. */
function unrollEvents(events) {
    const allEvents = new Set();
    function addEvents(events) {
        for (const event of events) {
            allEvents.add(event);
        }
    }
    for (const event of events) {
        switch (event) {
            case protocol_js_1$2.BrowsingContext.AllEvents:
                addEvents(Object.values(protocol_js_1$2.BrowsingContext.EventNames));
                break;
            case protocol_js_1$2.Log.AllEvents:
                addEvents(Object.values(protocol_js_1$2.Log.EventNames));
                break;
            case protocol_js_1$2.Network.AllEvents:
                addEvents(Object.values(protocol_js_1$2.Network.EventNames));
                break;
            case protocol_js_1$2.Script.AllEvents:
                addEvents(Object.values(protocol_js_1$2.Script.EventNames));
                break;
            default:
                allEvents.add(event);
        }
    }
    return [...allEvents.values()];
}
SubscriptionManager$1.unrollEvents = unrollEvents;
class SubscriptionManager {
    #subscriptionPriority = 0;
    // BrowsingContext `null` means the event has subscription across all the
    // browsing contexts.
    // Channel `null` means no `channel` should be added.
    #channelToContextToEventMap = new Map();
    #browsingContextStorage;
    constructor(browsingContextStorage) {
        this.#browsingContextStorage = browsingContextStorage;
    }
    getChannelsSubscribedToEvent(eventMethod, contextId) {
        const prioritiesAndChannels = Array.from(this.#channelToContextToEventMap.keys())
            .map((channel) => ({
            priority: this.#getEventSubscriptionPriorityForChannel(eventMethod, contextId, channel),
            channel,
        }))
            .filter(({ priority }) => priority !== null);
        // Sort channels by priority.
        return prioritiesAndChannels
            .sort((a, b) => a.priority - b.priority)
            .map(({ channel }) => channel);
    }
    #getEventSubscriptionPriorityForChannel(eventMethod, contextId, channel) {
        const contextToEventMap = this.#channelToContextToEventMap.get(channel);
        if (contextToEventMap === undefined) {
            return null;
        }
        const maybeTopLevelContextId = this.#browsingContextStorage.findTopLevelContextId(contextId);
        // `null` covers global subscription.
        const relevantContexts = [...new Set([null, maybeTopLevelContextId])];
        // Get all the subscription priorities.
        const priorities = relevantContexts
            .map((c) => contextToEventMap.get(c)?.get(eventMethod))
            .filter((p) => p !== undefined);
        if (priorities.length === 0) {
            // Not subscribed, return null.
            return null;
        }
        // Return minimal priority.
        return Math.min(...priorities);
    }
    subscribe(event, contextId, channel) {
        // All the subscriptions are handled on the top-level contexts.
        contextId = this.#browsingContextStorage.findTopLevelContextId(contextId);
        if (event === protocol_js_1$2.BrowsingContext.AllEvents) {
            Object.values(protocol_js_1$2.BrowsingContext.EventNames).map((specificEvent) => this.subscribe(specificEvent, contextId, channel));
            return;
        }
        if (event === protocol_js_1$2.Log.AllEvents) {
            Object.values(protocol_js_1$2.Log.EventNames).map((specificEvent) => this.subscribe(specificEvent, contextId, channel));
            return;
        }
        if (event === protocol_js_1$2.Network.AllEvents) {
            Object.values(protocol_js_1$2.Network.EventNames).map((specificEvent) => this.subscribe(specificEvent, contextId, channel));
            return;
        }
        if (event === protocol_js_1$2.Script.AllEvents) {
            Object.values(protocol_js_1$2.Script.EventNames).map((specificEvent) => this.subscribe(specificEvent, contextId, channel));
            return;
        }
        if (!this.#channelToContextToEventMap.has(channel)) {
            this.#channelToContextToEventMap.set(channel, new Map());
        }
        const contextToEventMap = this.#channelToContextToEventMap.get(channel);
        if (!contextToEventMap.has(contextId)) {
            contextToEventMap.set(contextId, new Map());
        }
        const eventMap = contextToEventMap.get(contextId);
        // Do not re-subscribe to events to keep the priority.
        if (eventMap.has(event)) {
            return;
        }
        eventMap.set(event, this.#subscriptionPriority++);
    }
    /**
     * Unsubscribes atomically from all events in the given contexts and channel.
     */
    unsubscribeAll(events, contextIds, channel) {
        // Assert all contexts are known.
        for (const contextId of contextIds) {
            if (contextId !== null) {
                this.#browsingContextStorage.getContext(contextId);
            }
        }
        const eventContextPairs = cartesianProduct(unrollEvents(events), contextIds);
        // Assert all unsubscriptions are valid.
        // If any of the unsubscriptions are invalid, do not unsubscribe from anything.
        eventContextPairs
            .map(([event, contextId]) => this.#checkUnsubscribe(event, contextId, channel))
            .forEach((unsubscribe) => unsubscribe());
    }
    /**
     * Unsubscribes from the event in the given context and channel.
     * Syntactic sugar for "unsubscribeAll".
     */
    unsubscribe(eventName, contextId, channel) {
        this.unsubscribeAll([eventName], [contextId], channel);
    }
    #checkUnsubscribe(event, contextId, channel) {
        // All the subscriptions are handled on the top-level contexts.
        contextId = this.#browsingContextStorage.findTopLevelContextId(contextId);
        if (!this.#channelToContextToEventMap.has(channel)) {
            throw new protocol_js_1$2.Message.InvalidArgumentException(`Cannot unsubscribe from ${event}, ${contextId === null ? 'null' : contextId}. No subscription found.`);
        }
        const contextToEventMap = this.#channelToContextToEventMap.get(channel);
        if (!contextToEventMap.has(contextId)) {
            throw new protocol_js_1$2.Message.InvalidArgumentException(`Cannot unsubscribe from ${event}, ${contextId === null ? 'null' : contextId}. No subscription found.`);
        }
        const eventMap = contextToEventMap.get(contextId);
        if (!eventMap.has(event)) {
            throw new protocol_js_1$2.Message.InvalidArgumentException(`Cannot unsubscribe from ${event}, ${contextId === null ? 'null' : contextId}. No subscription found.`);
        }
        return () => {
            eventMap.delete(event);
            // Clean up maps if empty.
            if (eventMap.size === 0) {
                contextToEventMap.delete(event);
            }
            if (contextToEventMap.size === 0) {
                this.#channelToContextToEventMap.delete(channel);
            }
        };
    }
}
SubscriptionManager$1.SubscriptionManager = SubscriptionManager;

/**
 * Copyright 2022 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(EventManager$1, "__esModule", { value: true });
EventManager$1.EventManager = void 0;
const protocol_js_1$1 = protocol;
const buffer_js_1 = buffer;
const idWrapper_js_1 = idWrapper;
const OutgoingBidiMessage_js_1 = OutgoingBidiMessage$1;
const DefaultMap_js_1 = DefaultMap$1;
const SubscriptionManager_js_1 = SubscriptionManager$1;
class EventWrapper {
    #idWrapper = new idWrapper_js_1.IdWrapper();
    #contextId;
    #event;
    constructor(event, contextId) {
        this.#event = event;
        this.#contextId = contextId;
    }
    get id() {
        return this.#idWrapper.id;
    }
    get contextId() {
        return this.#contextId;
    }
    get event() {
        return this.#event;
    }
}
/**
 * Maps event name to a desired buffer length.
 */
const eventBufferLength = new Map([
    [protocol_js_1$1.Log.EventNames.LogEntryAddedEvent, 100],
]);
class EventManager {
    static #NETWORK_DOMAIN_PREFIX = 'network';
    /**
     * Maps event name to a set of contexts where this event already happened.
     * Needed for getting buffered events from all the contexts in case of
     * subscripting to all contexts.
     */
    #eventToContextsMap = new DefaultMap_js_1.DefaultMap(() => new Set());
    /**
     * Maps `eventName` + `browsingContext` to buffer. Used to get buffered events
     * during subscription. Channel-agnostic.
     */
    #eventBuffers = new Map();
    /**
     * Maps `eventName` + `browsingContext` + `channel` to last sent event id.
     * Used to avoid sending duplicated events when user
     * subscribes -> unsubscribes -> subscribes.
     */
    #lastMessageSent = new Map();
    #subscriptionManager;
    #bidiServer;
    #isNetworkDomainEnabled;
    constructor(bidiServer) {
        this.#bidiServer = bidiServer;
        this.#subscriptionManager = new SubscriptionManager_js_1.SubscriptionManager(bidiServer.getBrowsingContextStorage());
        this.#isNetworkDomainEnabled = false;
    }
    get isNetworkDomainEnabled() {
        return this.#isNetworkDomainEnabled;
    }
    /**
     * Returns consistent key to be used to access value maps.
     */
    static #getMapKey(eventName, browsingContext, channel) {
        return JSON.stringify({ eventName, browsingContext, channel });
    }
    registerEvent(event, contextId) {
        this.registerPromiseEvent(Promise.resolve(event), contextId, event.method);
    }
    registerPromiseEvent(event, contextId, eventName) {
        const eventWrapper = new EventWrapper(event, contextId);
        const sortedChannels = this.#subscriptionManager.getChannelsSubscribedToEvent(eventName, contextId);
        this.#bufferEvent(eventWrapper, eventName);
        // Send events to channels in the subscription priority.
        for (const channel of sortedChannels) {
            this.#bidiServer.emitOutgoingMessage(OutgoingBidiMessage_js_1.OutgoingBidiMessage.createFromPromise(event, channel));
            this.#markEventSent(eventWrapper, channel, eventName);
        }
    }
    async subscribe(eventNames, contextIds, channel) {
        // First check if all the contexts are known.
        for (const contextId of contextIds) {
            if (contextId !== null) {
                // Assert the context is known. Throw exception otherwise.
                this.#bidiServer.getBrowsingContextStorage().getContext(contextId);
            }
        }
        for (const eventName of eventNames) {
            for (const contextId of contextIds) {
                await this.#handleDomains(eventName, contextId);
                this.#subscriptionManager.subscribe(eventName, contextId, channel);
                for (const eventWrapper of this.#getBufferedEvents(eventName, contextId, channel)) {
                    // The order of the events is important.
                    this.#bidiServer.emitOutgoingMessage(OutgoingBidiMessage_js_1.OutgoingBidiMessage.createFromPromise(eventWrapper.event, channel));
                    this.#markEventSent(eventWrapper, channel, eventName);
                }
            }
        }
    }
    /**
     * Enables domains for the subscribed event in the required contexts or
     * globally.
     */
    async #handleDomains(eventName, contextId) {
        // Enable network domain if user subscribed to any of network events.
        if (eventName.startsWith(EventManager.#NETWORK_DOMAIN_PREFIX)) {
            // Enable for all the contexts.
            if (contextId === null) {
                this.#isNetworkDomainEnabled = true;
                await Promise.all(this.#bidiServer
                    .getBrowsingContextStorage()
                    .getAllContexts()
                    .map((context) => context.cdpTarget.enableNetworkDomain()));
            }
            else {
                await this.#bidiServer
                    .getBrowsingContextStorage()
                    .getContext(contextId)
                    .cdpTarget.enableNetworkDomain();
            }
        }
    }
    unsubscribe(eventNames, contextIds, channel) {
        this.#subscriptionManager.unsubscribeAll(eventNames, contextIds, channel);
    }
    /**
     * If the event is buffer-able, put it in the buffer.
     */
    #bufferEvent(eventWrapper, eventName) {
        if (!eventBufferLength.has(eventName)) {
            // Do nothing if the event is no buffer-able.
            return;
        }
        const bufferMapKey = EventManager.#getMapKey(eventName, eventWrapper.contextId);
        if (!this.#eventBuffers.has(bufferMapKey)) {
            this.#eventBuffers.set(bufferMapKey, new buffer_js_1.Buffer(eventBufferLength.get(eventName)));
        }
        this.#eventBuffers.get(bufferMapKey).add(eventWrapper);
        // Add the context to the list of contexts having `eventName` events.
        this.#eventToContextsMap.get(eventName).add(eventWrapper.contextId);
    }
    /**
     * If the event is buffer-able, mark it as sent to the given contextId and channel.
     */
    #markEventSent(eventWrapper, channel, eventName) {
        if (!eventBufferLength.has(eventName)) {
            // Do nothing if the event is no buffer-able.
            return;
        }
        const lastSentMapKey = EventManager.#getMapKey(eventName, eventWrapper.contextId, channel);
        this.#lastMessageSent.set(lastSentMapKey, Math.max(this.#lastMessageSent.get(lastSentMapKey) ?? 0, eventWrapper.id));
    }
    /**
     * Returns events which are buffered and not yet sent to the given channel events.
     */
    #getBufferedEvents(eventName, contextId, channel) {
        const bufferMapKey = EventManager.#getMapKey(eventName, contextId);
        const lastSentMapKey = EventManager.#getMapKey(eventName, contextId, channel);
        const lastSentMessageId = this.#lastMessageSent.get(lastSentMapKey) ?? -Infinity;
        const result = this.#eventBuffers
            .get(bufferMapKey)
            ?.get()
            .filter((wrapper) => wrapper.id > lastSentMessageId) ?? [];
        if (contextId === null) {
            // For global subscriptions, events buffered in each context should be sent back.
            Array.from(this.#eventToContextsMap.get(eventName).keys())
                .filter((_contextId) => 
            // Events without context are already in the result.
            _contextId !== null &&
                // Events from deleted contexts should not be sent.
                this.#bidiServer.getBrowsingContextStorage().hasContext(_contextId))
                .map((_contextId) => this.#getBufferedEvents(eventName, _contextId, channel))
                .forEach((events) => result.push(...events));
        }
        return result.sort((e1, e2) => e1.id - e2.id);
    }
}
EventManager$1.EventManager = EventManager;

var realmStorage = {};

Object.defineProperty(realmStorage, "__esModule", { value: true });
realmStorage.RealmStorage = void 0;
const protocol_js_1 = protocol;
/** Container class for browsing realms. */
class RealmStorage {
    /** Tracks handles and their realms sent to the client. */
    #knownHandlesToRealm = new Map();
    /** Map from realm ID to Realm. */
    #realmMap = new Map();
    get knownHandlesToRealm() {
        return this.#knownHandlesToRealm;
    }
    addRealm(realm) {
        this.#realmMap.set(realm.realmId, realm);
    }
    /** Finds all realms that match the given filter. */
    findRealms(filter) {
        return Array.from(this.#realmMap.values()).filter((realm) => {
            if (filter.realmId !== undefined && filter.realmId !== realm.realmId) {
                return false;
            }
            if (filter.browsingContextId !== undefined &&
                filter.browsingContextId !== realm.browsingContextId) {
                return false;
            }
            if (filter.navigableId !== undefined &&
                filter.navigableId !== realm.navigableId) {
                return false;
            }
            if (filter.executionContextId !== undefined &&
                filter.executionContextId !== realm.executionContextId) {
                return false;
            }
            if (filter.origin !== undefined && filter.origin !== realm.origin) {
                return false;
            }
            if (filter.type !== undefined && filter.type !== realm.type) {
                return false;
            }
            if (filter.sandbox !== undefined && filter.sandbox !== realm.sandbox) {
                return false;
            }
            if (filter.cdpSessionId !== undefined &&
                filter.cdpSessionId !== realm.cdpSessionId) {
                return false;
            }
            return true;
        });
    }
    findRealm(filter) {
        const maybeRealms = this.findRealms(filter);
        if (maybeRealms.length !== 1) {
            return undefined;
        }
        return maybeRealms[0];
    }
    /** Gets the only realm that matches the given filter, if any, otherwise throws. */
    getRealm(filter) {
        const maybeRealm = this.findRealm(filter);
        if (maybeRealm === undefined) {
            throw new protocol_js_1.Message.NoSuchFrameException(`Realm ${JSON.stringify(filter)} not found`);
        }
        return maybeRealm;
    }
    /** Deletes all realms that match the given filter. */
    deleteRealms(filter) {
        this.findRealms(filter).map((realm) => {
            realm.delete();
            this.#realmMap.delete(realm.realmId);
            Array.from(this.knownHandlesToRealm.entries())
                .filter(([, r]) => r === realm.realmId)
                .map(([handle]) => this.knownHandlesToRealm.delete(handle));
        });
    }
}
realmStorage.RealmStorage = RealmStorage;

/**
 * Copyright 2021 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(BidiServer$1, "__esModule", { value: true });
BidiServer$1.BidiServer = void 0;
const EventEmitter_js_1 = EventEmitter$1;
const log_js_1 = log;
const processingQueue_js_1 = processingQueue;
const CommandProcessor_js_1 = CommandProcessor$1;
const browsingContextStorage_js_1 = browsingContextStorage;
const EventManager_js_1 = EventManager$1;
const realmStorage_js_1 = realmStorage;
class BidiServer extends EventEmitter_js_1.EventEmitter {
    #messageQueue;
    #transport;
    #commandProcessor;
    #browsingContextStorage = new browsingContextStorage_js_1.BrowsingContextStorage();
    #realmStorage = new realmStorage_js_1.RealmStorage();
    #logger;
    #handleIncomingMessage = (message) => {
        void this.#commandProcessor.processCommand(message).catch((error) => {
            this.#logger?.(log_js_1.LogType.system, error);
        });
    };
    #processOutgoingMessage = async (messageEntry) => {
        const message = messageEntry.message;
        if (messageEntry.channel !== null) {
            message['channel'] = messageEntry.channel;
        }
        await this.#transport.sendMessage(message);
    };
    constructor(bidiTransport, cdpConnection, selfTargetId, parser, logger) {
        super();
        this.#logger = logger;
        this.#messageQueue = new processingQueue_js_1.ProcessingQueue(this.#processOutgoingMessage, this.#logger);
        this.#transport = bidiTransport;
        this.#transport.setOnMessage(this.#handleIncomingMessage);
        this.#commandProcessor = new CommandProcessor_js_1.CommandProcessor(cdpConnection, new EventManager_js_1.EventManager(this), selfTargetId, parser, this.#browsingContextStorage, this.#realmStorage, this.#logger);
        this.#commandProcessor.on('response', (response) => {
            this.emitOutgoingMessage(response);
        });
    }
    static async createAndStart(bidiTransport, cdpConnection, selfTargetId, parser, logger) {
        const server = new BidiServer(bidiTransport, cdpConnection, selfTargetId, parser, logger);
        const cdpClient = cdpConnection.browserClient();
        // Needed to get events about new targets.
        await cdpClient.sendCommand('Target.setDiscoverTargets', { discover: true });
        // Needed to automatically attach to new targets.
        await cdpClient.sendCommand('Target.setAutoAttach', {
            autoAttach: true,
            waitForDebuggerOnStart: true,
            flatten: true,
        });
        await server.topLevelContextsLoaded();
        return server;
    }
    async topLevelContextsLoaded() {
        await Promise.all(this.#browsingContextStorage
            .getTopLevelContexts()
            .map((c) => c.awaitLoaded()));
    }
    /**
     * Sends BiDi message.
     */
    emitOutgoingMessage(messageEntry) {
        this.#messageQueue.add(messageEntry);
    }
    close() {
        this.#transport.close();
    }
    getBrowsingContextStorage() {
        return this.#browsingContextStorage;
    }
}
BidiServer$1.BidiServer = BidiServer;

(function (exports) {
	/**
	 * Copyright 2022 Google LLC.
	 * Copyright (c) Microsoft Corporation.
	 *
	 * Licensed under the Apache License, Version 2.0 (the "License");
	 * you may not use this file except in compliance with the License.
	 * You may obtain a copy of the License at
	 *
	 *     http://www.apache.org/licenses/LICENSE-2.0
	 *
	 * Unless required by applicable law or agreed to in writing, software
	 * distributed under the License is distributed on an "AS IS" BASIS,
	 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	 * See the License for the specific language governing permissions and
	 * limitations under the License.
	 */
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.OutgoingBidiMessage = exports.EventEmitter = exports.BidiServer = void 0;
	/**
	 * @fileoverview The entry point to the BiDi Mapper namespace.
	 * Other modules should only access exports defined in this file.
	 * XXX: Add ESlint rule for this (https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-restricted-paths.md)
	 */
	var BidiServer_js_1 = BidiServer$1;
	Object.defineProperty(exports, "BidiServer", { enumerable: true, get: function () { return BidiServer_js_1.BidiServer; } });
	var EventEmitter_js_1 = EventEmitter$1;
	Object.defineProperty(exports, "EventEmitter", { enumerable: true, get: function () { return EventEmitter_js_1.EventEmitter; } });
	var OutgoingBidiMessage_js_1 = OutgoingBidiMessage$1;
	Object.defineProperty(exports, "OutgoingBidiMessage", { enumerable: true, get: function () { return OutgoingBidiMessage_js_1.OutgoingBidiMessage; } });
	
} (bidiMapper));

/**
 * Copyright 2023 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @internal
 */
async function connectBidiOverCDP(cdp) {
    const transportBiDi = new NoOpTransport();
    const cdpConnectionAdapter = new CDPConnectionAdapter(cdp);
    const pptrTransport = {
        send(message) {
            // Forwards a BiDi command sent by Puppeteer to the input of the BidiServer.
            transportBiDi.emitMessage(JSON.parse(message));
        },
        close() {
            bidiServer.close();
            cdpConnectionAdapter.close();
        },
        onmessage(_message) {
            // The method is overridden by the Connection.
        },
    };
    transportBiDi.on('bidiResponse', (message) => {
        // Forwards a BiDi event sent by BidiServer to Puppeteer.
        pptrTransport.onmessage(JSON.stringify(message));
    });
    const pptrBiDiConnection = new Connection(cdp.url(), pptrTransport);
    const bidiServer = await bidiMapper.BidiServer.createAndStart(transportBiDi, cdpConnectionAdapter, '');
    return pptrBiDiConnection;
}
/**
 * Manages CDPSessions for BidiServer.
 * @internal
 */
class CDPConnectionAdapter {
    #cdp;
    #adapters = new Map();
    #browser;
    constructor(cdp) {
        this.#cdp = cdp;
        this.#browser = new CDPClientAdapter(cdp);
    }
    browserClient() {
        return this.#browser;
    }
    getCdpClient(id) {
        const session = this.#cdp.session(id);
        if (!session) {
            throw new Error('Unknown CDP session with id' + id);
        }
        if (!this.#adapters.has(session)) {
            const adapter = new CDPClientAdapter(session);
            this.#adapters.set(session, adapter);
            return adapter;
        }
        return this.#adapters.get(session);
    }
    close() {
        this.#browser.close();
        for (const adapter of this.#adapters.values()) {
            adapter.close();
        }
    }
}
/**
 * Wrapper on top of CDPSession/CDPConnection to satisfy CDP interface that
 * BidiServer needs.
 *
 * @internal
 */
class CDPClientAdapter extends bidiMapper.EventEmitter {
    #closed = false;
    #client;
    constructor(client) {
        super();
        this.#client = client;
        this.#client.on('*', this.#forwardMessage);
    }
    #forwardMessage = (method, event) => {
        this.emit(method, event);
    };
    async sendCommand(method, ...params) {
        if (this.#closed) {
            return;
        }
        try {
            return await this.#client.send(method, ...params);
        }
        catch (err) {
            if (this.#closed) {
                return;
            }
            throw err;
        }
    }
    close() {
        this.#client.off('*', this.#forwardMessage);
        this.#closed = true;
    }
    isCloseError(error) {
        return error instanceof index.TargetCloseError;
    }
}
/**
 * This transport is given to the BiDi server instance and allows Puppeteer
 * to send and receive commands to the BiDiServer.
 * @internal
 */
class NoOpTransport extends bidiMapper.EventEmitter {
    #onMessage = async (_m) => {
        return;
    };
    emitMessage(message) {
        void this.#onMessage(message);
    }
    setOnMessage(onMessage) {
        this.#onMessage = onMessage;
    }
    async sendMessage(message) {
        this.emit('bidiResponse', message);
    }
    close() {
        this.#onMessage = async (_m) => {
            return;
        };
    }
}

exports.Browser = Browser;
exports.BrowserContext = BrowserContext;
exports.Connection = Connection;
exports.Page = Page;
exports.connectBidiOverCDP = connectBidiOverCDP;
