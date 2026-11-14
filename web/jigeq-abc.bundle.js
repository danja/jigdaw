var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/base64-js/index.js
var require_base64_js = __commonJS({
  "node_modules/base64-js/index.js"(exports) {
    "use strict";
    exports.byteLength = byteLength;
    exports.toByteArray = toByteArray;
    exports.fromByteArray = fromByteArray;
    var lookup = [];
    var revLookup = [];
    var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
    var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (i2 = 0, len = code.length; i2 < len; ++i2) {
      lookup[i2] = code[i2];
      revLookup[code.charCodeAt(i2)] = i2;
    }
    var i2;
    var len;
    revLookup["-".charCodeAt(0)] = 62;
    revLookup["_".charCodeAt(0)] = 63;
    function getLens(b64) {
      var len2 = b64.length;
      if (len2 % 4 > 0) {
        throw new Error("Invalid string. Length must be a multiple of 4");
      }
      var validLen = b64.indexOf("=");
      if (validLen === -1) validLen = len2;
      var placeHoldersLen = validLen === len2 ? 0 : 4 - validLen % 4;
      return [validLen, placeHoldersLen];
    }
    function byteLength(b64) {
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function _byteLength(b64, validLen, placeHoldersLen) {
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function toByteArray(b64) {
      var tmp;
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen));
      var curByte = 0;
      var len2 = placeHoldersLen > 0 ? validLen - 4 : validLen;
      var i3;
      for (i3 = 0; i3 < len2; i3 += 4) {
        tmp = revLookup[b64.charCodeAt(i3)] << 18 | revLookup[b64.charCodeAt(i3 + 1)] << 12 | revLookup[b64.charCodeAt(i3 + 2)] << 6 | revLookup[b64.charCodeAt(i3 + 3)];
        arr[curByte++] = tmp >> 16 & 255;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 2) {
        tmp = revLookup[b64.charCodeAt(i3)] << 2 | revLookup[b64.charCodeAt(i3 + 1)] >> 4;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 1) {
        tmp = revLookup[b64.charCodeAt(i3)] << 10 | revLookup[b64.charCodeAt(i3 + 1)] << 4 | revLookup[b64.charCodeAt(i3 + 2)] >> 2;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      return arr;
    }
    function tripletToBase64(num) {
      return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63];
    }
    function encodeChunk(uint8, start, end) {
      var tmp;
      var output = [];
      for (var i3 = start; i3 < end; i3 += 3) {
        tmp = (uint8[i3] << 16 & 16711680) + (uint8[i3 + 1] << 8 & 65280) + (uint8[i3 + 2] & 255);
        output.push(tripletToBase64(tmp));
      }
      return output.join("");
    }
    function fromByteArray(uint8) {
      var tmp;
      var len2 = uint8.length;
      var extraBytes = len2 % 3;
      var parts = [];
      var maxChunkLength = 16383;
      for (var i3 = 0, len22 = len2 - extraBytes; i3 < len22; i3 += maxChunkLength) {
        parts.push(encodeChunk(uint8, i3, i3 + maxChunkLength > len22 ? len22 : i3 + maxChunkLength));
      }
      if (extraBytes === 1) {
        tmp = uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 2] + lookup[tmp << 4 & 63] + "=="
        );
      } else if (extraBytes === 2) {
        tmp = (uint8[len2 - 2] << 8) + uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 10] + lookup[tmp >> 4 & 63] + lookup[tmp << 2 & 63] + "="
        );
      }
      return parts.join("");
    }
  }
});

// node_modules/ieee754/index.js
var require_ieee754 = __commonJS({
  "node_modules/ieee754/index.js"(exports) {
    exports.read = function(buffer, offset, isLE, mLen, nBytes) {
      var e, m;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var nBits = -7;
      var i2 = isLE ? nBytes - 1 : 0;
      var d = isLE ? -1 : 1;
      var s = buffer[offset + i2];
      i2 += d;
      e = s & (1 << -nBits) - 1;
      s >>= -nBits;
      nBits += eLen;
      for (; nBits > 0; e = e * 256 + buffer[offset + i2], i2 += d, nBits -= 8) {
      }
      m = e & (1 << -nBits) - 1;
      e >>= -nBits;
      nBits += mLen;
      for (; nBits > 0; m = m * 256 + buffer[offset + i2], i2 += d, nBits -= 8) {
      }
      if (e === 0) {
        e = 1 - eBias;
      } else if (e === eMax) {
        return m ? NaN : (s ? -1 : 1) * Infinity;
      } else {
        m = m + Math.pow(2, mLen);
        e = e - eBias;
      }
      return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
    };
    exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
      var e, m, c3;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
      var i2 = isLE ? 0 : nBytes - 1;
      var d = isLE ? 1 : -1;
      var s = value < 0 || value === 0 && 1 / value < 0 ? 1 : 0;
      value = Math.abs(value);
      if (isNaN(value) || value === Infinity) {
        m = isNaN(value) ? 1 : 0;
        e = eMax;
      } else {
        e = Math.floor(Math.log(value) / Math.LN2);
        if (value * (c3 = Math.pow(2, -e)) < 1) {
          e--;
          c3 *= 2;
        }
        if (e + eBias >= 1) {
          value += rt / c3;
        } else {
          value += rt * Math.pow(2, 1 - eBias);
        }
        if (value * c3 >= 2) {
          e++;
          c3 /= 2;
        }
        if (e + eBias >= eMax) {
          m = 0;
          e = eMax;
        } else if (e + eBias >= 1) {
          m = (value * c3 - 1) * Math.pow(2, mLen);
          e = e + eBias;
        } else {
          m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
          e = 0;
        }
      }
      for (; mLen >= 8; buffer[offset + i2] = m & 255, i2 += d, m /= 256, mLen -= 8) {
      }
      e = e << mLen | m;
      eLen += mLen;
      for (; eLen > 0; buffer[offset + i2] = e & 255, i2 += d, e /= 256, eLen -= 8) {
      }
      buffer[offset + i2 - d] |= s * 128;
    };
  }
});

// node_modules/buffer/index.js
var require_buffer = __commonJS({
  "node_modules/buffer/index.js"(exports) {
    "use strict";
    var base64 = require_base64_js();
    var ieee754 = require_ieee754();
    var customInspectSymbol = typeof Symbol === "function" && typeof Symbol["for"] === "function" ? Symbol["for"]("nodejs.util.inspect.custom") : null;
    exports.Buffer = Buffer3;
    exports.SlowBuffer = SlowBuffer;
    exports.INSPECT_MAX_BYTES = 50;
    var K_MAX_LENGTH = 2147483647;
    exports.kMaxLength = K_MAX_LENGTH;
    Buffer3.TYPED_ARRAY_SUPPORT = typedArraySupport();
    if (!Buffer3.TYPED_ARRAY_SUPPORT && typeof console !== "undefined" && typeof console.error === "function") {
      console.error(
        "This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."
      );
    }
    function typedArraySupport() {
      try {
        const arr = new Uint8Array(1);
        const proto = { foo: function() {
          return 42;
        } };
        Object.setPrototypeOf(proto, Uint8Array.prototype);
        Object.setPrototypeOf(arr, proto);
        return arr.foo() === 42;
      } catch (e) {
        return false;
      }
    }
    Object.defineProperty(Buffer3.prototype, "parent", {
      enumerable: true,
      get: function() {
        if (!Buffer3.isBuffer(this)) return void 0;
        return this.buffer;
      }
    });
    Object.defineProperty(Buffer3.prototype, "offset", {
      enumerable: true,
      get: function() {
        if (!Buffer3.isBuffer(this)) return void 0;
        return this.byteOffset;
      }
    });
    function createBuffer(length) {
      if (length > K_MAX_LENGTH) {
        throw new RangeError('The value "' + length + '" is invalid for option "size"');
      }
      const buf = new Uint8Array(length);
      Object.setPrototypeOf(buf, Buffer3.prototype);
      return buf;
    }
    function Buffer3(arg, encodingOrOffset, length) {
      if (typeof arg === "number") {
        if (typeof encodingOrOffset === "string") {
          throw new TypeError(
            'The "string" argument must be of type string. Received type number'
          );
        }
        return allocUnsafe(arg);
      }
      return from(arg, encodingOrOffset, length);
    }
    Buffer3.poolSize = 8192;
    function from(value, encodingOrOffset, length) {
      if (typeof value === "string") {
        return fromString(value, encodingOrOffset);
      }
      if (ArrayBuffer.isView(value)) {
        return fromArrayView(value);
      }
      if (value == null) {
        throw new TypeError(
          "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
        );
      }
      if (isInstance(value, ArrayBuffer) || value && isInstance(value.buffer, ArrayBuffer)) {
        return fromArrayBuffer(value, encodingOrOffset, length);
      }
      if (typeof SharedArrayBuffer !== "undefined" && (isInstance(value, SharedArrayBuffer) || value && isInstance(value.buffer, SharedArrayBuffer))) {
        return fromArrayBuffer(value, encodingOrOffset, length);
      }
      if (typeof value === "number") {
        throw new TypeError(
          'The "value" argument must not be of type number. Received type number'
        );
      }
      const valueOf = value.valueOf && value.valueOf();
      if (valueOf != null && valueOf !== value) {
        return Buffer3.from(valueOf, encodingOrOffset, length);
      }
      const b = fromObject(value);
      if (b) return b;
      if (typeof Symbol !== "undefined" && Symbol.toPrimitive != null && typeof value[Symbol.toPrimitive] === "function") {
        return Buffer3.from(value[Symbol.toPrimitive]("string"), encodingOrOffset, length);
      }
      throw new TypeError(
        "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
      );
    }
    Buffer3.from = function(value, encodingOrOffset, length) {
      return from(value, encodingOrOffset, length);
    };
    Object.setPrototypeOf(Buffer3.prototype, Uint8Array.prototype);
    Object.setPrototypeOf(Buffer3, Uint8Array);
    function assertSize(size) {
      if (typeof size !== "number") {
        throw new TypeError('"size" argument must be of type number');
      } else if (size < 0) {
        throw new RangeError('The value "' + size + '" is invalid for option "size"');
      }
    }
    function alloc(size, fill, encoding) {
      assertSize(size);
      if (size <= 0) {
        return createBuffer(size);
      }
      if (fill !== void 0) {
        return typeof encoding === "string" ? createBuffer(size).fill(fill, encoding) : createBuffer(size).fill(fill);
      }
      return createBuffer(size);
    }
    Buffer3.alloc = function(size, fill, encoding) {
      return alloc(size, fill, encoding);
    };
    function allocUnsafe(size) {
      assertSize(size);
      return createBuffer(size < 0 ? 0 : checked(size) | 0);
    }
    Buffer3.allocUnsafe = function(size) {
      return allocUnsafe(size);
    };
    Buffer3.allocUnsafeSlow = function(size) {
      return allocUnsafe(size);
    };
    function fromString(string, encoding) {
      if (typeof encoding !== "string" || encoding === "") {
        encoding = "utf8";
      }
      if (!Buffer3.isEncoding(encoding)) {
        throw new TypeError("Unknown encoding: " + encoding);
      }
      const length = byteLength(string, encoding) | 0;
      let buf = createBuffer(length);
      const actual = buf.write(string, encoding);
      if (actual !== length) {
        buf = buf.slice(0, actual);
      }
      return buf;
    }
    function fromArrayLike(array) {
      const length = array.length < 0 ? 0 : checked(array.length) | 0;
      const buf = createBuffer(length);
      for (let i2 = 0; i2 < length; i2 += 1) {
        buf[i2] = array[i2] & 255;
      }
      return buf;
    }
    function fromArrayView(arrayView) {
      if (isInstance(arrayView, Uint8Array)) {
        const copy = new Uint8Array(arrayView);
        return fromArrayBuffer(copy.buffer, copy.byteOffset, copy.byteLength);
      }
      return fromArrayLike(arrayView);
    }
    function fromArrayBuffer(array, byteOffset, length) {
      if (byteOffset < 0 || array.byteLength < byteOffset) {
        throw new RangeError('"offset" is outside of buffer bounds');
      }
      if (array.byteLength < byteOffset + (length || 0)) {
        throw new RangeError('"length" is outside of buffer bounds');
      }
      let buf;
      if (byteOffset === void 0 && length === void 0) {
        buf = new Uint8Array(array);
      } else if (length === void 0) {
        buf = new Uint8Array(array, byteOffset);
      } else {
        buf = new Uint8Array(array, byteOffset, length);
      }
      Object.setPrototypeOf(buf, Buffer3.prototype);
      return buf;
    }
    function fromObject(obj) {
      if (Buffer3.isBuffer(obj)) {
        const len = checked(obj.length) | 0;
        const buf = createBuffer(len);
        if (buf.length === 0) {
          return buf;
        }
        obj.copy(buf, 0, 0, len);
        return buf;
      }
      if (obj.length !== void 0) {
        if (typeof obj.length !== "number" || numberIsNaN(obj.length)) {
          return createBuffer(0);
        }
        return fromArrayLike(obj);
      }
      if (obj.type === "Buffer" && Array.isArray(obj.data)) {
        return fromArrayLike(obj.data);
      }
    }
    function checked(length) {
      if (length >= K_MAX_LENGTH) {
        throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x" + K_MAX_LENGTH.toString(16) + " bytes");
      }
      return length | 0;
    }
    function SlowBuffer(length) {
      if (+length != length) {
        length = 0;
      }
      return Buffer3.alloc(+length);
    }
    Buffer3.isBuffer = function isBuffer(b) {
      return b != null && b._isBuffer === true && b !== Buffer3.prototype;
    };
    Buffer3.compare = function compare(a2, b) {
      if (isInstance(a2, Uint8Array)) a2 = Buffer3.from(a2, a2.offset, a2.byteLength);
      if (isInstance(b, Uint8Array)) b = Buffer3.from(b, b.offset, b.byteLength);
      if (!Buffer3.isBuffer(a2) || !Buffer3.isBuffer(b)) {
        throw new TypeError(
          'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
        );
      }
      if (a2 === b) return 0;
      let x = a2.length;
      let y = b.length;
      for (let i2 = 0, len = Math.min(x, y); i2 < len; ++i2) {
        if (a2[i2] !== b[i2]) {
          x = a2[i2];
          y = b[i2];
          break;
        }
      }
      if (x < y) return -1;
      if (y < x) return 1;
      return 0;
    };
    Buffer3.isEncoding = function isEncoding(encoding) {
      switch (String(encoding).toLowerCase()) {
        case "hex":
        case "utf8":
        case "utf-8":
        case "ascii":
        case "latin1":
        case "binary":
        case "base64":
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return true;
        default:
          return false;
      }
    };
    Buffer3.concat = function concat(list, length) {
      if (!Array.isArray(list)) {
        throw new TypeError('"list" argument must be an Array of Buffers');
      }
      if (list.length === 0) {
        return Buffer3.alloc(0);
      }
      let i2;
      if (length === void 0) {
        length = 0;
        for (i2 = 0; i2 < list.length; ++i2) {
          length += list[i2].length;
        }
      }
      const buffer = Buffer3.allocUnsafe(length);
      let pos = 0;
      for (i2 = 0; i2 < list.length; ++i2) {
        let buf = list[i2];
        if (isInstance(buf, Uint8Array)) {
          if (pos + buf.length > buffer.length) {
            if (!Buffer3.isBuffer(buf)) buf = Buffer3.from(buf);
            buf.copy(buffer, pos);
          } else {
            Uint8Array.prototype.set.call(
              buffer,
              buf,
              pos
            );
          }
        } else if (!Buffer3.isBuffer(buf)) {
          throw new TypeError('"list" argument must be an Array of Buffers');
        } else {
          buf.copy(buffer, pos);
        }
        pos += buf.length;
      }
      return buffer;
    };
    function byteLength(string, encoding) {
      if (Buffer3.isBuffer(string)) {
        return string.length;
      }
      if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
        return string.byteLength;
      }
      if (typeof string !== "string") {
        throw new TypeError(
          'The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type ' + typeof string
        );
      }
      const len = string.length;
      const mustMatch = arguments.length > 2 && arguments[2] === true;
      if (!mustMatch && len === 0) return 0;
      let loweredCase = false;
      for (; ; ) {
        switch (encoding) {
          case "ascii":
          case "latin1":
          case "binary":
            return len;
          case "utf8":
          case "utf-8":
            return utf8ToBytes(string).length;
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return len * 2;
          case "hex":
            return len >>> 1;
          case "base64":
            return base64ToBytes(string).length;
          default:
            if (loweredCase) {
              return mustMatch ? -1 : utf8ToBytes(string).length;
            }
            encoding = ("" + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    }
    Buffer3.byteLength = byteLength;
    function slowToString(encoding, start, end) {
      let loweredCase = false;
      if (start === void 0 || start < 0) {
        start = 0;
      }
      if (start > this.length) {
        return "";
      }
      if (end === void 0 || end > this.length) {
        end = this.length;
      }
      if (end <= 0) {
        return "";
      }
      end >>>= 0;
      start >>>= 0;
      if (end <= start) {
        return "";
      }
      if (!encoding) encoding = "utf8";
      while (true) {
        switch (encoding) {
          case "hex":
            return hexSlice(this, start, end);
          case "utf8":
          case "utf-8":
            return utf8Slice(this, start, end);
          case "ascii":
            return asciiSlice(this, start, end);
          case "latin1":
          case "binary":
            return latin1Slice(this, start, end);
          case "base64":
            return base64Slice(this, start, end);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return utf16leSlice(this, start, end);
          default:
            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
            encoding = (encoding + "").toLowerCase();
            loweredCase = true;
        }
      }
    }
    Buffer3.prototype._isBuffer = true;
    function swap(b, n2, m) {
      const i2 = b[n2];
      b[n2] = b[m];
      b[m] = i2;
    }
    Buffer3.prototype.swap16 = function swap16() {
      const len = this.length;
      if (len % 2 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 16-bits");
      }
      for (let i2 = 0; i2 < len; i2 += 2) {
        swap(this, i2, i2 + 1);
      }
      return this;
    };
    Buffer3.prototype.swap32 = function swap32() {
      const len = this.length;
      if (len % 4 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 32-bits");
      }
      for (let i2 = 0; i2 < len; i2 += 4) {
        swap(this, i2, i2 + 3);
        swap(this, i2 + 1, i2 + 2);
      }
      return this;
    };
    Buffer3.prototype.swap64 = function swap64() {
      const len = this.length;
      if (len % 8 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 64-bits");
      }
      for (let i2 = 0; i2 < len; i2 += 8) {
        swap(this, i2, i2 + 7);
        swap(this, i2 + 1, i2 + 6);
        swap(this, i2 + 2, i2 + 5);
        swap(this, i2 + 3, i2 + 4);
      }
      return this;
    };
    Buffer3.prototype.toString = function toString2() {
      const length = this.length;
      if (length === 0) return "";
      if (arguments.length === 0) return utf8Slice(this, 0, length);
      return slowToString.apply(this, arguments);
    };
    Buffer3.prototype.toLocaleString = Buffer3.prototype.toString;
    Buffer3.prototype.equals = function equals3(b) {
      if (!Buffer3.isBuffer(b)) throw new TypeError("Argument must be a Buffer");
      if (this === b) return true;
      return Buffer3.compare(this, b) === 0;
    };
    Buffer3.prototype.inspect = function inspect2() {
      let str = "";
      const max = exports.INSPECT_MAX_BYTES;
      str = this.toString("hex", 0, max).replace(/(.{2})/g, "$1 ").trim();
      if (this.length > max) str += " ... ";
      return "<Buffer " + str + ">";
    };
    if (customInspectSymbol) {
      Buffer3.prototype[customInspectSymbol] = Buffer3.prototype.inspect;
    }
    Buffer3.prototype.compare = function compare(target, start, end, thisStart, thisEnd) {
      if (isInstance(target, Uint8Array)) {
        target = Buffer3.from(target, target.offset, target.byteLength);
      }
      if (!Buffer3.isBuffer(target)) {
        throw new TypeError(
          'The "target" argument must be one of type Buffer or Uint8Array. Received type ' + typeof target
        );
      }
      if (start === void 0) {
        start = 0;
      }
      if (end === void 0) {
        end = target ? target.length : 0;
      }
      if (thisStart === void 0) {
        thisStart = 0;
      }
      if (thisEnd === void 0) {
        thisEnd = this.length;
      }
      if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
        throw new RangeError("out of range index");
      }
      if (thisStart >= thisEnd && start >= end) {
        return 0;
      }
      if (thisStart >= thisEnd) {
        return -1;
      }
      if (start >= end) {
        return 1;
      }
      start >>>= 0;
      end >>>= 0;
      thisStart >>>= 0;
      thisEnd >>>= 0;
      if (this === target) return 0;
      let x = thisEnd - thisStart;
      let y = end - start;
      const len = Math.min(x, y);
      const thisCopy = this.slice(thisStart, thisEnd);
      const targetCopy = target.slice(start, end);
      for (let i2 = 0; i2 < len; ++i2) {
        if (thisCopy[i2] !== targetCopy[i2]) {
          x = thisCopy[i2];
          y = targetCopy[i2];
          break;
        }
      }
      if (x < y) return -1;
      if (y < x) return 1;
      return 0;
    };
    function bidirectionalIndexOf(buffer, val, byteOffset, encoding, dir) {
      if (buffer.length === 0) return -1;
      if (typeof byteOffset === "string") {
        encoding = byteOffset;
        byteOffset = 0;
      } else if (byteOffset > 2147483647) {
        byteOffset = 2147483647;
      } else if (byteOffset < -2147483648) {
        byteOffset = -2147483648;
      }
      byteOffset = +byteOffset;
      if (numberIsNaN(byteOffset)) {
        byteOffset = dir ? 0 : buffer.length - 1;
      }
      if (byteOffset < 0) byteOffset = buffer.length + byteOffset;
      if (byteOffset >= buffer.length) {
        if (dir) return -1;
        else byteOffset = buffer.length - 1;
      } else if (byteOffset < 0) {
        if (dir) byteOffset = 0;
        else return -1;
      }
      if (typeof val === "string") {
        val = Buffer3.from(val, encoding);
      }
      if (Buffer3.isBuffer(val)) {
        if (val.length === 0) {
          return -1;
        }
        return arrayIndexOf(buffer, val, byteOffset, encoding, dir);
      } else if (typeof val === "number") {
        val = val & 255;
        if (typeof Uint8Array.prototype.indexOf === "function") {
          if (dir) {
            return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset);
          } else {
            return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset);
          }
        }
        return arrayIndexOf(buffer, [val], byteOffset, encoding, dir);
      }
      throw new TypeError("val must be string, number or Buffer");
    }
    function arrayIndexOf(arr, val, byteOffset, encoding, dir) {
      let indexSize = 1;
      let arrLength = arr.length;
      let valLength = val.length;
      if (encoding !== void 0) {
        encoding = String(encoding).toLowerCase();
        if (encoding === "ucs2" || encoding === "ucs-2" || encoding === "utf16le" || encoding === "utf-16le") {
          if (arr.length < 2 || val.length < 2) {
            return -1;
          }
          indexSize = 2;
          arrLength /= 2;
          valLength /= 2;
          byteOffset /= 2;
        }
      }
      function read(buf, i3) {
        if (indexSize === 1) {
          return buf[i3];
        } else {
          return buf.readUInt16BE(i3 * indexSize);
        }
      }
      let i2;
      if (dir) {
        let foundIndex = -1;
        for (i2 = byteOffset; i2 < arrLength; i2++) {
          if (read(arr, i2) === read(val, foundIndex === -1 ? 0 : i2 - foundIndex)) {
            if (foundIndex === -1) foundIndex = i2;
            if (i2 - foundIndex + 1 === valLength) return foundIndex * indexSize;
          } else {
            if (foundIndex !== -1) i2 -= i2 - foundIndex;
            foundIndex = -1;
          }
        }
      } else {
        if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength;
        for (i2 = byteOffset; i2 >= 0; i2--) {
          let found = true;
          for (let j = 0; j < valLength; j++) {
            if (read(arr, i2 + j) !== read(val, j)) {
              found = false;
              break;
            }
          }
          if (found) return i2;
        }
      }
      return -1;
    }
    Buffer3.prototype.includes = function includes(val, byteOffset, encoding) {
      return this.indexOf(val, byteOffset, encoding) !== -1;
    };
    Buffer3.prototype.indexOf = function indexOf(val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, true);
    };
    Buffer3.prototype.lastIndexOf = function lastIndexOf(val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, false);
    };
    function hexWrite(buf, string, offset, length) {
      offset = Number(offset) || 0;
      const remaining = buf.length - offset;
      if (!length) {
        length = remaining;
      } else {
        length = Number(length);
        if (length > remaining) {
          length = remaining;
        }
      }
      const strLen = string.length;
      if (length > strLen / 2) {
        length = strLen / 2;
      }
      let i2;
      for (i2 = 0; i2 < length; ++i2) {
        const parsed = parseInt(string.substr(i2 * 2, 2), 16);
        if (numberIsNaN(parsed)) return i2;
        buf[offset + i2] = parsed;
      }
      return i2;
    }
    function utf8Write(buf, string, offset, length) {
      return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length);
    }
    function asciiWrite(buf, string, offset, length) {
      return blitBuffer(asciiToBytes(string), buf, offset, length);
    }
    function base64Write(buf, string, offset, length) {
      return blitBuffer(base64ToBytes(string), buf, offset, length);
    }
    function ucs2Write(buf, string, offset, length) {
      return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length);
    }
    Buffer3.prototype.write = function write(string, offset, length, encoding) {
      if (offset === void 0) {
        encoding = "utf8";
        length = this.length;
        offset = 0;
      } else if (length === void 0 && typeof offset === "string") {
        encoding = offset;
        length = this.length;
        offset = 0;
      } else if (isFinite(offset)) {
        offset = offset >>> 0;
        if (isFinite(length)) {
          length = length >>> 0;
          if (encoding === void 0) encoding = "utf8";
        } else {
          encoding = length;
          length = void 0;
        }
      } else {
        throw new Error(
          "Buffer.write(string, encoding, offset[, length]) is no longer supported"
        );
      }
      const remaining = this.length - offset;
      if (length === void 0 || length > remaining) length = remaining;
      if (string.length > 0 && (length < 0 || offset < 0) || offset > this.length) {
        throw new RangeError("Attempt to write outside buffer bounds");
      }
      if (!encoding) encoding = "utf8";
      let loweredCase = false;
      for (; ; ) {
        switch (encoding) {
          case "hex":
            return hexWrite(this, string, offset, length);
          case "utf8":
          case "utf-8":
            return utf8Write(this, string, offset, length);
          case "ascii":
          case "latin1":
          case "binary":
            return asciiWrite(this, string, offset, length);
          case "base64":
            return base64Write(this, string, offset, length);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return ucs2Write(this, string, offset, length);
          default:
            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
            encoding = ("" + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    };
    Buffer3.prototype.toJSON = function toJSON() {
      return {
        type: "Buffer",
        data: Array.prototype.slice.call(this._arr || this, 0)
      };
    };
    function base64Slice(buf, start, end) {
      if (start === 0 && end === buf.length) {
        return base64.fromByteArray(buf);
      } else {
        return base64.fromByteArray(buf.slice(start, end));
      }
    }
    function utf8Slice(buf, start, end) {
      end = Math.min(buf.length, end);
      const res = [];
      let i2 = start;
      while (i2 < end) {
        const firstByte = buf[i2];
        let codePoint = null;
        let bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
        if (i2 + bytesPerSequence <= end) {
          let secondByte, thirdByte, fourthByte, tempCodePoint;
          switch (bytesPerSequence) {
            case 1:
              if (firstByte < 128) {
                codePoint = firstByte;
              }
              break;
            case 2:
              secondByte = buf[i2 + 1];
              if ((secondByte & 192) === 128) {
                tempCodePoint = (firstByte & 31) << 6 | secondByte & 63;
                if (tempCodePoint > 127) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 3:
              secondByte = buf[i2 + 1];
              thirdByte = buf[i2 + 2];
              if ((secondByte & 192) === 128 && (thirdByte & 192) === 128) {
                tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63;
                if (tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343)) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 4:
              secondByte = buf[i2 + 1];
              thirdByte = buf[i2 + 2];
              fourthByte = buf[i2 + 3];
              if ((secondByte & 192) === 128 && (thirdByte & 192) === 128 && (fourthByte & 192) === 128) {
                tempCodePoint = (firstByte & 15) << 18 | (secondByte & 63) << 12 | (thirdByte & 63) << 6 | fourthByte & 63;
                if (tempCodePoint > 65535 && tempCodePoint < 1114112) {
                  codePoint = tempCodePoint;
                }
              }
          }
        }
        if (codePoint === null) {
          codePoint = 65533;
          bytesPerSequence = 1;
        } else if (codePoint > 65535) {
          codePoint -= 65536;
          res.push(codePoint >>> 10 & 1023 | 55296);
          codePoint = 56320 | codePoint & 1023;
        }
        res.push(codePoint);
        i2 += bytesPerSequence;
      }
      return decodeCodePointsArray(res);
    }
    var MAX_ARGUMENTS_LENGTH = 4096;
    function decodeCodePointsArray(codePoints) {
      const len = codePoints.length;
      if (len <= MAX_ARGUMENTS_LENGTH) {
        return String.fromCharCode.apply(String, codePoints);
      }
      let res = "";
      let i2 = 0;
      while (i2 < len) {
        res += String.fromCharCode.apply(
          String,
          codePoints.slice(i2, i2 += MAX_ARGUMENTS_LENGTH)
        );
      }
      return res;
    }
    function asciiSlice(buf, start, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i2 = start; i2 < end; ++i2) {
        ret += String.fromCharCode(buf[i2] & 127);
      }
      return ret;
    }
    function latin1Slice(buf, start, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i2 = start; i2 < end; ++i2) {
        ret += String.fromCharCode(buf[i2]);
      }
      return ret;
    }
    function hexSlice(buf, start, end) {
      const len = buf.length;
      if (!start || start < 0) start = 0;
      if (!end || end < 0 || end > len) end = len;
      let out = "";
      for (let i2 = start; i2 < end; ++i2) {
        out += hexSliceLookupTable[buf[i2]];
      }
      return out;
    }
    function utf16leSlice(buf, start, end) {
      const bytes = buf.slice(start, end);
      let res = "";
      for (let i2 = 0; i2 < bytes.length - 1; i2 += 2) {
        res += String.fromCharCode(bytes[i2] + bytes[i2 + 1] * 256);
      }
      return res;
    }
    Buffer3.prototype.slice = function slice(start, end) {
      const len = this.length;
      start = ~~start;
      end = end === void 0 ? len : ~~end;
      if (start < 0) {
        start += len;
        if (start < 0) start = 0;
      } else if (start > len) {
        start = len;
      }
      if (end < 0) {
        end += len;
        if (end < 0) end = 0;
      } else if (end > len) {
        end = len;
      }
      if (end < start) end = start;
      const newBuf = this.subarray(start, end);
      Object.setPrototypeOf(newBuf, Buffer3.prototype);
      return newBuf;
    };
    function checkOffset(offset, ext, length) {
      if (offset % 1 !== 0 || offset < 0) throw new RangeError("offset is not uint");
      if (offset + ext > length) throw new RangeError("Trying to access beyond buffer length");
    }
    Buffer3.prototype.readUintLE = Buffer3.prototype.readUIntLE = function readUIntLE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let val = this[offset];
      let mul = 1;
      let i2 = 0;
      while (++i2 < byteLength2 && (mul *= 256)) {
        val += this[offset + i2] * mul;
      }
      return val;
    };
    Buffer3.prototype.readUintBE = Buffer3.prototype.readUIntBE = function readUIntBE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        checkOffset(offset, byteLength2, this.length);
      }
      let val = this[offset + --byteLength2];
      let mul = 1;
      while (byteLength2 > 0 && (mul *= 256)) {
        val += this[offset + --byteLength2] * mul;
      }
      return val;
    };
    Buffer3.prototype.readUint8 = Buffer3.prototype.readUInt8 = function readUInt8(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 1, this.length);
      return this[offset];
    };
    Buffer3.prototype.readUint16LE = Buffer3.prototype.readUInt16LE = function readUInt16LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      return this[offset] | this[offset + 1] << 8;
    };
    Buffer3.prototype.readUint16BE = Buffer3.prototype.readUInt16BE = function readUInt16BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      return this[offset] << 8 | this[offset + 1];
    };
    Buffer3.prototype.readUint32LE = Buffer3.prototype.readUInt32LE = function readUInt32LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return (this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16) + this[offset + 3] * 16777216;
    };
    Buffer3.prototype.readUint32BE = Buffer3.prototype.readUInt32BE = function readUInt32BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] * 16777216 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]);
    };
    Buffer3.prototype.readBigUInt64LE = defineBigIntMethod(function readBigUInt64LE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first3 = this[offset];
      const last = this[offset + 7];
      if (first3 === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const lo = first3 + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24;
      const hi = this[++offset] + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + last * 2 ** 24;
      return BigInt(lo) + (BigInt(hi) << BigInt(32));
    });
    Buffer3.prototype.readBigUInt64BE = defineBigIntMethod(function readBigUInt64BE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first3 = this[offset];
      const last = this[offset + 7];
      if (first3 === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const hi = first3 * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
      const lo = this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last;
      return (BigInt(hi) << BigInt(32)) + BigInt(lo);
    });
    Buffer3.prototype.readIntLE = function readIntLE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let val = this[offset];
      let mul = 1;
      let i2 = 0;
      while (++i2 < byteLength2 && (mul *= 256)) {
        val += this[offset + i2] * mul;
      }
      mul *= 128;
      if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
      return val;
    };
    Buffer3.prototype.readIntBE = function readIntBE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let i2 = byteLength2;
      let mul = 1;
      let val = this[offset + --i2];
      while (i2 > 0 && (mul *= 256)) {
        val += this[offset + --i2] * mul;
      }
      mul *= 128;
      if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
      return val;
    };
    Buffer3.prototype.readInt8 = function readInt8(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 1, this.length);
      if (!(this[offset] & 128)) return this[offset];
      return (255 - this[offset] + 1) * -1;
    };
    Buffer3.prototype.readInt16LE = function readInt16LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      const val = this[offset] | this[offset + 1] << 8;
      return val & 32768 ? val | 4294901760 : val;
    };
    Buffer3.prototype.readInt16BE = function readInt16BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      const val = this[offset + 1] | this[offset] << 8;
      return val & 32768 ? val | 4294901760 : val;
    };
    Buffer3.prototype.readInt32LE = function readInt32LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16 | this[offset + 3] << 24;
    };
    Buffer3.prototype.readInt32BE = function readInt32BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3];
    };
    Buffer3.prototype.readBigInt64LE = defineBigIntMethod(function readBigInt64LE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first3 = this[offset];
      const last = this[offset + 7];
      if (first3 === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const val = this[offset + 4] + this[offset + 5] * 2 ** 8 + this[offset + 6] * 2 ** 16 + (last << 24);
      return (BigInt(val) << BigInt(32)) + BigInt(first3 + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24);
    });
    Buffer3.prototype.readBigInt64BE = defineBigIntMethod(function readBigInt64BE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first3 = this[offset];
      const last = this[offset + 7];
      if (first3 === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const val = (first3 << 24) + // Overflow
      this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
      return (BigInt(val) << BigInt(32)) + BigInt(this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last);
    });
    Buffer3.prototype.readFloatLE = function readFloatLE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return ieee754.read(this, offset, true, 23, 4);
    };
    Buffer3.prototype.readFloatBE = function readFloatBE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return ieee754.read(this, offset, false, 23, 4);
    };
    Buffer3.prototype.readDoubleLE = function readDoubleLE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 8, this.length);
      return ieee754.read(this, offset, true, 52, 8);
    };
    Buffer3.prototype.readDoubleBE = function readDoubleBE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 8, this.length);
      return ieee754.read(this, offset, false, 52, 8);
    };
    function checkInt(buf, value, offset, ext, max, min) {
      if (!Buffer3.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance');
      if (value > max || value < min) throw new RangeError('"value" argument is out of bounds');
      if (offset + ext > buf.length) throw new RangeError("Index out of range");
    }
    Buffer3.prototype.writeUintLE = Buffer3.prototype.writeUIntLE = function writeUIntLE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
        checkInt(this, value, offset, byteLength2, maxBytes, 0);
      }
      let mul = 1;
      let i2 = 0;
      this[offset] = value & 255;
      while (++i2 < byteLength2 && (mul *= 256)) {
        this[offset + i2] = value / mul & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeUintBE = Buffer3.prototype.writeUIntBE = function writeUIntBE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
        checkInt(this, value, offset, byteLength2, maxBytes, 0);
      }
      let i2 = byteLength2 - 1;
      let mul = 1;
      this[offset + i2] = value & 255;
      while (--i2 >= 0 && (mul *= 256)) {
        this[offset + i2] = value / mul & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeUint8 = Buffer3.prototype.writeUInt8 = function writeUInt8(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 1, 255, 0);
      this[offset] = value & 255;
      return offset + 1;
    };
    Buffer3.prototype.writeUint16LE = Buffer3.prototype.writeUInt16LE = function writeUInt16LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      return offset + 2;
    };
    Buffer3.prototype.writeUint16BE = Buffer3.prototype.writeUInt16BE = function writeUInt16BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
      this[offset] = value >>> 8;
      this[offset + 1] = value & 255;
      return offset + 2;
    };
    Buffer3.prototype.writeUint32LE = Buffer3.prototype.writeUInt32LE = function writeUInt32LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
      this[offset + 3] = value >>> 24;
      this[offset + 2] = value >>> 16;
      this[offset + 1] = value >>> 8;
      this[offset] = value & 255;
      return offset + 4;
    };
    Buffer3.prototype.writeUint32BE = Buffer3.prototype.writeUInt32BE = function writeUInt32BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
      this[offset] = value >>> 24;
      this[offset + 1] = value >>> 16;
      this[offset + 2] = value >>> 8;
      this[offset + 3] = value & 255;
      return offset + 4;
    };
    function wrtBigUInt64LE(buf, value, offset, min, max) {
      checkIntBI(value, min, max, buf, offset, 7);
      let lo = Number(value & BigInt(4294967295));
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      let hi = Number(value >> BigInt(32) & BigInt(4294967295));
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      return offset;
    }
    function wrtBigUInt64BE(buf, value, offset, min, max) {
      checkIntBI(value, min, max, buf, offset, 7);
      let lo = Number(value & BigInt(4294967295));
      buf[offset + 7] = lo;
      lo = lo >> 8;
      buf[offset + 6] = lo;
      lo = lo >> 8;
      buf[offset + 5] = lo;
      lo = lo >> 8;
      buf[offset + 4] = lo;
      let hi = Number(value >> BigInt(32) & BigInt(4294967295));
      buf[offset + 3] = hi;
      hi = hi >> 8;
      buf[offset + 2] = hi;
      hi = hi >> 8;
      buf[offset + 1] = hi;
      hi = hi >> 8;
      buf[offset] = hi;
      return offset + 8;
    }
    Buffer3.prototype.writeBigUInt64LE = defineBigIntMethod(function writeBigUInt64LE(value, offset = 0) {
      return wrtBigUInt64LE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
    });
    Buffer3.prototype.writeBigUInt64BE = defineBigIntMethod(function writeBigUInt64BE(value, offset = 0) {
      return wrtBigUInt64BE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
    });
    Buffer3.prototype.writeIntLE = function writeIntLE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        const limit = Math.pow(2, 8 * byteLength2 - 1);
        checkInt(this, value, offset, byteLength2, limit - 1, -limit);
      }
      let i2 = 0;
      let mul = 1;
      let sub = 0;
      this[offset] = value & 255;
      while (++i2 < byteLength2 && (mul *= 256)) {
        if (value < 0 && sub === 0 && this[offset + i2 - 1] !== 0) {
          sub = 1;
        }
        this[offset + i2] = (value / mul >> 0) - sub & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeIntBE = function writeIntBE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        const limit = Math.pow(2, 8 * byteLength2 - 1);
        checkInt(this, value, offset, byteLength2, limit - 1, -limit);
      }
      let i2 = byteLength2 - 1;
      let mul = 1;
      let sub = 0;
      this[offset + i2] = value & 255;
      while (--i2 >= 0 && (mul *= 256)) {
        if (value < 0 && sub === 0 && this[offset + i2 + 1] !== 0) {
          sub = 1;
        }
        this[offset + i2] = (value / mul >> 0) - sub & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeInt8 = function writeInt8(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 1, 127, -128);
      if (value < 0) value = 255 + value + 1;
      this[offset] = value & 255;
      return offset + 1;
    };
    Buffer3.prototype.writeInt16LE = function writeInt16LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      return offset + 2;
    };
    Buffer3.prototype.writeInt16BE = function writeInt16BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
      this[offset] = value >>> 8;
      this[offset + 1] = value & 255;
      return offset + 2;
    };
    Buffer3.prototype.writeInt32LE = function writeInt32LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      this[offset + 2] = value >>> 16;
      this[offset + 3] = value >>> 24;
      return offset + 4;
    };
    Buffer3.prototype.writeInt32BE = function writeInt32BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
      if (value < 0) value = 4294967295 + value + 1;
      this[offset] = value >>> 24;
      this[offset + 1] = value >>> 16;
      this[offset + 2] = value >>> 8;
      this[offset + 3] = value & 255;
      return offset + 4;
    };
    Buffer3.prototype.writeBigInt64LE = defineBigIntMethod(function writeBigInt64LE(value, offset = 0) {
      return wrtBigUInt64LE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
    });
    Buffer3.prototype.writeBigInt64BE = defineBigIntMethod(function writeBigInt64BE(value, offset = 0) {
      return wrtBigUInt64BE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
    });
    function checkIEEE754(buf, value, offset, ext, max, min) {
      if (offset + ext > buf.length) throw new RangeError("Index out of range");
      if (offset < 0) throw new RangeError("Index out of range");
    }
    function writeFloat(buf, value, offset, littleEndian, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 4, 34028234663852886e22, -34028234663852886e22);
      }
      ieee754.write(buf, value, offset, littleEndian, 23, 4);
      return offset + 4;
    }
    Buffer3.prototype.writeFloatLE = function writeFloatLE(value, offset, noAssert) {
      return writeFloat(this, value, offset, true, noAssert);
    };
    Buffer3.prototype.writeFloatBE = function writeFloatBE(value, offset, noAssert) {
      return writeFloat(this, value, offset, false, noAssert);
    };
    function writeDouble(buf, value, offset, littleEndian, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 8, 17976931348623157e292, -17976931348623157e292);
      }
      ieee754.write(buf, value, offset, littleEndian, 52, 8);
      return offset + 8;
    }
    Buffer3.prototype.writeDoubleLE = function writeDoubleLE(value, offset, noAssert) {
      return writeDouble(this, value, offset, true, noAssert);
    };
    Buffer3.prototype.writeDoubleBE = function writeDoubleBE(value, offset, noAssert) {
      return writeDouble(this, value, offset, false, noAssert);
    };
    Buffer3.prototype.copy = function copy(target, targetStart, start, end) {
      if (!Buffer3.isBuffer(target)) throw new TypeError("argument should be a Buffer");
      if (!start) start = 0;
      if (!end && end !== 0) end = this.length;
      if (targetStart >= target.length) targetStart = target.length;
      if (!targetStart) targetStart = 0;
      if (end > 0 && end < start) end = start;
      if (end === start) return 0;
      if (target.length === 0 || this.length === 0) return 0;
      if (targetStart < 0) {
        throw new RangeError("targetStart out of bounds");
      }
      if (start < 0 || start >= this.length) throw new RangeError("Index out of range");
      if (end < 0) throw new RangeError("sourceEnd out of bounds");
      if (end > this.length) end = this.length;
      if (target.length - targetStart < end - start) {
        end = target.length - targetStart + start;
      }
      const len = end - start;
      if (this === target && typeof Uint8Array.prototype.copyWithin === "function") {
        this.copyWithin(targetStart, start, end);
      } else {
        Uint8Array.prototype.set.call(
          target,
          this.subarray(start, end),
          targetStart
        );
      }
      return len;
    };
    Buffer3.prototype.fill = function fill(val, start, end, encoding) {
      if (typeof val === "string") {
        if (typeof start === "string") {
          encoding = start;
          start = 0;
          end = this.length;
        } else if (typeof end === "string") {
          encoding = end;
          end = this.length;
        }
        if (encoding !== void 0 && typeof encoding !== "string") {
          throw new TypeError("encoding must be a string");
        }
        if (typeof encoding === "string" && !Buffer3.isEncoding(encoding)) {
          throw new TypeError("Unknown encoding: " + encoding);
        }
        if (val.length === 1) {
          const code = val.charCodeAt(0);
          if (encoding === "utf8" && code < 128 || encoding === "latin1") {
            val = code;
          }
        }
      } else if (typeof val === "number") {
        val = val & 255;
      } else if (typeof val === "boolean") {
        val = Number(val);
      }
      if (start < 0 || this.length < start || this.length < end) {
        throw new RangeError("Out of range index");
      }
      if (end <= start) {
        return this;
      }
      start = start >>> 0;
      end = end === void 0 ? this.length : end >>> 0;
      if (!val) val = 0;
      let i2;
      if (typeof val === "number") {
        for (i2 = start; i2 < end; ++i2) {
          this[i2] = val;
        }
      } else {
        const bytes = Buffer3.isBuffer(val) ? val : Buffer3.from(val, encoding);
        const len = bytes.length;
        if (len === 0) {
          throw new TypeError('The value "' + val + '" is invalid for argument "value"');
        }
        for (i2 = 0; i2 < end - start; ++i2) {
          this[i2 + start] = bytes[i2 % len];
        }
      }
      return this;
    };
    var errors = {};
    function E(sym, getMessage, Base) {
      errors[sym] = class NodeError extends Base {
        constructor() {
          super();
          Object.defineProperty(this, "message", {
            value: getMessage.apply(this, arguments),
            writable: true,
            configurable: true
          });
          this.name = `${this.name} [${sym}]`;
          this.stack;
          delete this.name;
        }
        get code() {
          return sym;
        }
        set code(value) {
          Object.defineProperty(this, "code", {
            configurable: true,
            enumerable: true,
            value,
            writable: true
          });
        }
        toString() {
          return `${this.name} [${sym}]: ${this.message}`;
        }
      };
    }
    E(
      "ERR_BUFFER_OUT_OF_BOUNDS",
      function(name) {
        if (name) {
          return `${name} is outside of buffer bounds`;
        }
        return "Attempt to access memory outside buffer bounds";
      },
      RangeError
    );
    E(
      "ERR_INVALID_ARG_TYPE",
      function(name, actual) {
        return `The "${name}" argument must be of type number. Received type ${typeof actual}`;
      },
      TypeError
    );
    E(
      "ERR_OUT_OF_RANGE",
      function(str, range, input) {
        let msg = `The value of "${str}" is out of range.`;
        let received = input;
        if (Number.isInteger(input) && Math.abs(input) > 2 ** 32) {
          received = addNumericalSeparator(String(input));
        } else if (typeof input === "bigint") {
          received = String(input);
          if (input > BigInt(2) ** BigInt(32) || input < -(BigInt(2) ** BigInt(32))) {
            received = addNumericalSeparator(received);
          }
          received += "n";
        }
        msg += ` It must be ${range}. Received ${received}`;
        return msg;
      },
      RangeError
    );
    function addNumericalSeparator(val) {
      let res = "";
      let i2 = val.length;
      const start = val[0] === "-" ? 1 : 0;
      for (; i2 >= start + 4; i2 -= 3) {
        res = `_${val.slice(i2 - 3, i2)}${res}`;
      }
      return `${val.slice(0, i2)}${res}`;
    }
    function checkBounds(buf, offset, byteLength2) {
      validateNumber(offset, "offset");
      if (buf[offset] === void 0 || buf[offset + byteLength2] === void 0) {
        boundsError(offset, buf.length - (byteLength2 + 1));
      }
    }
    function checkIntBI(value, min, max, buf, offset, byteLength2) {
      if (value > max || value < min) {
        const n2 = typeof min === "bigint" ? "n" : "";
        let range;
        if (byteLength2 > 3) {
          if (min === 0 || min === BigInt(0)) {
            range = `>= 0${n2} and < 2${n2} ** ${(byteLength2 + 1) * 8}${n2}`;
          } else {
            range = `>= -(2${n2} ** ${(byteLength2 + 1) * 8 - 1}${n2}) and < 2 ** ${(byteLength2 + 1) * 8 - 1}${n2}`;
          }
        } else {
          range = `>= ${min}${n2} and <= ${max}${n2}`;
        }
        throw new errors.ERR_OUT_OF_RANGE("value", range, value);
      }
      checkBounds(buf, offset, byteLength2);
    }
    function validateNumber(value, name) {
      if (typeof value !== "number") {
        throw new errors.ERR_INVALID_ARG_TYPE(name, "number", value);
      }
    }
    function boundsError(value, length, type) {
      if (Math.floor(value) !== value) {
        validateNumber(value, type);
        throw new errors.ERR_OUT_OF_RANGE(type || "offset", "an integer", value);
      }
      if (length < 0) {
        throw new errors.ERR_BUFFER_OUT_OF_BOUNDS();
      }
      throw new errors.ERR_OUT_OF_RANGE(
        type || "offset",
        `>= ${type ? 1 : 0} and <= ${length}`,
        value
      );
    }
    var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g;
    function base64clean(str) {
      str = str.split("=")[0];
      str = str.trim().replace(INVALID_BASE64_RE, "");
      if (str.length < 2) return "";
      while (str.length % 4 !== 0) {
        str = str + "=";
      }
      return str;
    }
    function utf8ToBytes(string, units2) {
      units2 = units2 || Infinity;
      let codePoint;
      const length = string.length;
      let leadSurrogate = null;
      const bytes = [];
      for (let i2 = 0; i2 < length; ++i2) {
        codePoint = string.charCodeAt(i2);
        if (codePoint > 55295 && codePoint < 57344) {
          if (!leadSurrogate) {
            if (codePoint > 56319) {
              if ((units2 -= 3) > -1) bytes.push(239, 191, 189);
              continue;
            } else if (i2 + 1 === length) {
              if ((units2 -= 3) > -1) bytes.push(239, 191, 189);
              continue;
            }
            leadSurrogate = codePoint;
            continue;
          }
          if (codePoint < 56320) {
            if ((units2 -= 3) > -1) bytes.push(239, 191, 189);
            leadSurrogate = codePoint;
            continue;
          }
          codePoint = (leadSurrogate - 55296 << 10 | codePoint - 56320) + 65536;
        } else if (leadSurrogate) {
          if ((units2 -= 3) > -1) bytes.push(239, 191, 189);
        }
        leadSurrogate = null;
        if (codePoint < 128) {
          if ((units2 -= 1) < 0) break;
          bytes.push(codePoint);
        } else if (codePoint < 2048) {
          if ((units2 -= 2) < 0) break;
          bytes.push(
            codePoint >> 6 | 192,
            codePoint & 63 | 128
          );
        } else if (codePoint < 65536) {
          if ((units2 -= 3) < 0) break;
          bytes.push(
            codePoint >> 12 | 224,
            codePoint >> 6 & 63 | 128,
            codePoint & 63 | 128
          );
        } else if (codePoint < 1114112) {
          if ((units2 -= 4) < 0) break;
          bytes.push(
            codePoint >> 18 | 240,
            codePoint >> 12 & 63 | 128,
            codePoint >> 6 & 63 | 128,
            codePoint & 63 | 128
          );
        } else {
          throw new Error("Invalid code point");
        }
      }
      return bytes;
    }
    function asciiToBytes(str) {
      const byteArray = [];
      for (let i2 = 0; i2 < str.length; ++i2) {
        byteArray.push(str.charCodeAt(i2) & 255);
      }
      return byteArray;
    }
    function utf16leToBytes(str, units2) {
      let c3, hi, lo;
      const byteArray = [];
      for (let i2 = 0; i2 < str.length; ++i2) {
        if ((units2 -= 2) < 0) break;
        c3 = str.charCodeAt(i2);
        hi = c3 >> 8;
        lo = c3 % 256;
        byteArray.push(lo);
        byteArray.push(hi);
      }
      return byteArray;
    }
    function base64ToBytes(str) {
      return base64.toByteArray(base64clean(str));
    }
    function blitBuffer(src, dst, offset, length) {
      let i2;
      for (i2 = 0; i2 < length; ++i2) {
        if (i2 + offset >= dst.length || i2 >= src.length) break;
        dst[i2 + offset] = src[i2];
      }
      return i2;
    }
    function isInstance(obj, type) {
      return obj instanceof type || obj != null && obj.constructor != null && obj.constructor.name != null && obj.constructor.name === type.name;
    }
    function numberIsNaN(obj) {
      return obj !== obj;
    }
    var hexSliceLookupTable = (function() {
      const alphabet = "0123456789abcdef";
      const table = new Array(256);
      for (let i2 = 0; i2 < 16; ++i2) {
        const i16 = i2 * 16;
        for (let j = 0; j < 16; ++j) {
          table[i16 + j] = alphabet[i2] + alphabet[j];
        }
      }
      return table;
    })();
    function defineBigIntMethod(fn) {
      return typeof BigInt === "undefined" ? BufferBigIntNotDefined : fn;
    }
    function BufferBigIntNotDefined() {
      throw new Error("BigInt not supported");
    }
  }
});

// node_modules/readable-stream/lib/ours/primordials.js
var require_primordials = __commonJS({
  "node_modules/readable-stream/lib/ours/primordials.js"(exports, module) {
    "use strict";
    var AggregateError = class extends Error {
      constructor(errors) {
        if (!Array.isArray(errors)) {
          throw new TypeError(`Expected input to be an Array, got ${typeof errors}`);
        }
        let message = "";
        for (let i2 = 0; i2 < errors.length; i2++) {
          message += `    ${errors[i2].stack}
`;
        }
        super(message);
        this.name = "AggregateError";
        this.errors = errors;
      }
    };
    module.exports = {
      AggregateError,
      ArrayIsArray(self2) {
        return Array.isArray(self2);
      },
      ArrayPrototypeIncludes(self2, el) {
        return self2.includes(el);
      },
      ArrayPrototypeIndexOf(self2, el) {
        return self2.indexOf(el);
      },
      ArrayPrototypeJoin(self2, sep) {
        return self2.join(sep);
      },
      ArrayPrototypeMap(self2, fn) {
        return self2.map(fn);
      },
      ArrayPrototypePop(self2, el) {
        return self2.pop(el);
      },
      ArrayPrototypePush(self2, el) {
        return self2.push(el);
      },
      ArrayPrototypeSlice(self2, start, end) {
        return self2.slice(start, end);
      },
      Error,
      FunctionPrototypeCall(fn, thisArgs, ...args) {
        return fn.call(thisArgs, ...args);
      },
      FunctionPrototypeSymbolHasInstance(self2, instance) {
        return Function.prototype[Symbol.hasInstance].call(self2, instance);
      },
      MathFloor: Math.floor,
      Number,
      NumberIsInteger: Number.isInteger,
      NumberIsNaN: Number.isNaN,
      NumberMAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
      NumberMIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
      NumberParseInt: Number.parseInt,
      ObjectDefineProperties(self2, props) {
        return Object.defineProperties(self2, props);
      },
      ObjectDefineProperty(self2, name, prop) {
        return Object.defineProperty(self2, name, prop);
      },
      ObjectGetOwnPropertyDescriptor(self2, name) {
        return Object.getOwnPropertyDescriptor(self2, name);
      },
      ObjectKeys(obj) {
        return Object.keys(obj);
      },
      ObjectSetPrototypeOf(target, proto) {
        return Object.setPrototypeOf(target, proto);
      },
      Promise,
      PromisePrototypeCatch(self2, fn) {
        return self2.catch(fn);
      },
      PromisePrototypeThen(self2, thenFn, catchFn) {
        return self2.then(thenFn, catchFn);
      },
      PromiseReject(err) {
        return Promise.reject(err);
      },
      PromiseResolve(val) {
        return Promise.resolve(val);
      },
      ReflectApply: Reflect.apply,
      RegExpPrototypeTest(self2, value) {
        return self2.test(value);
      },
      SafeSet: Set,
      String,
      StringPrototypeSlice(self2, start, end) {
        return self2.slice(start, end);
      },
      StringPrototypeToLowerCase(self2) {
        return self2.toLowerCase();
      },
      StringPrototypeToUpperCase(self2) {
        return self2.toUpperCase();
      },
      StringPrototypeTrim(self2) {
        return self2.trim();
      },
      Symbol,
      SymbolFor: Symbol.for,
      SymbolAsyncIterator: Symbol.asyncIterator,
      SymbolHasInstance: Symbol.hasInstance,
      SymbolIterator: Symbol.iterator,
      SymbolDispose: Symbol.dispose || /* @__PURE__ */ Symbol("Symbol.dispose"),
      SymbolAsyncDispose: Symbol.asyncDispose || /* @__PURE__ */ Symbol("Symbol.asyncDispose"),
      TypedArrayPrototypeSet(self2, buf, len) {
        return self2.set(buf, len);
      },
      Boolean,
      Uint8Array
    };
  }
});

// node_modules/readable-stream/lib/ours/util/inspect.js
var require_inspect = __commonJS({
  "node_modules/readable-stream/lib/ours/util/inspect.js"(exports, module) {
    "use strict";
    module.exports = {
      format(format, ...args) {
        return format.replace(/%([sdifj])/g, function(...[_unused, type]) {
          const replacement = args.shift();
          if (type === "f") {
            return replacement.toFixed(6);
          } else if (type === "j") {
            return JSON.stringify(replacement);
          } else if (type === "s" && typeof replacement === "object") {
            const ctor = replacement.constructor !== Object ? replacement.constructor.name : "";
            return `${ctor} {}`.trim();
          } else {
            return replacement.toString();
          }
        });
      },
      inspect(value) {
        switch (typeof value) {
          case "string":
            if (value.includes("'")) {
              if (!value.includes('"')) {
                return `"${value}"`;
              } else if (!value.includes("`") && !value.includes("${")) {
                return `\`${value}\``;
              }
            }
            return `'${value}'`;
          case "number":
            if (isNaN(value)) {
              return "NaN";
            } else if (Object.is(value, -0)) {
              return String(value);
            }
            return value;
          case "bigint":
            return `${String(value)}n`;
          case "boolean":
          case "undefined":
            return String(value);
          case "object":
            return "{}";
        }
      }
    };
  }
});

// node_modules/readable-stream/lib/ours/errors.js
var require_errors = __commonJS({
  "node_modules/readable-stream/lib/ours/errors.js"(exports, module) {
    "use strict";
    var { format, inspect: inspect2 } = require_inspect();
    var { AggregateError: CustomAggregateError } = require_primordials();
    var AggregateError = globalThis.AggregateError || CustomAggregateError;
    var kIsNodeError = /* @__PURE__ */ Symbol("kIsNodeError");
    var kTypes = [
      "string",
      "function",
      "number",
      "object",
      // Accept 'Function' and 'Object' as alternative to the lower cased version.
      "Function",
      "Object",
      "boolean",
      "bigint",
      "symbol"
    ];
    var classRegExp = /^([A-Z][a-z0-9]*)+$/;
    var nodeInternalPrefix = "__node_internal_";
    var codes = {};
    function assert(value, message) {
      if (!value) {
        throw new codes.ERR_INTERNAL_ASSERTION(message);
      }
    }
    function addNumericalSeparator(val) {
      let res = "";
      let i2 = val.length;
      const start = val[0] === "-" ? 1 : 0;
      for (; i2 >= start + 4; i2 -= 3) {
        res = `_${val.slice(i2 - 3, i2)}${res}`;
      }
      return `${val.slice(0, i2)}${res}`;
    }
    function getMessage(key, msg, args) {
      if (typeof msg === "function") {
        assert(
          msg.length <= args.length,
          // Default options do not count.
          `Code: ${key}; The provided arguments length (${args.length}) does not match the required ones (${msg.length}).`
        );
        return msg(...args);
      }
      const expectedLength = (msg.match(/%[dfijoOs]/g) || []).length;
      assert(
        expectedLength === args.length,
        `Code: ${key}; The provided arguments length (${args.length}) does not match the required ones (${expectedLength}).`
      );
      if (args.length === 0) {
        return msg;
      }
      return format(msg, ...args);
    }
    function E(code, message, Base) {
      if (!Base) {
        Base = Error;
      }
      class NodeError extends Base {
        constructor(...args) {
          super(getMessage(code, message, args));
        }
        toString() {
          return `${this.name} [${code}]: ${this.message}`;
        }
      }
      Object.defineProperties(NodeError.prototype, {
        name: {
          value: Base.name,
          writable: true,
          enumerable: false,
          configurable: true
        },
        toString: {
          value() {
            return `${this.name} [${code}]: ${this.message}`;
          },
          writable: true,
          enumerable: false,
          configurable: true
        }
      });
      NodeError.prototype.code = code;
      NodeError.prototype[kIsNodeError] = true;
      codes[code] = NodeError;
    }
    function hideStackFrames(fn) {
      const hidden = nodeInternalPrefix + fn.name;
      Object.defineProperty(fn, "name", {
        value: hidden
      });
      return fn;
    }
    function aggregateTwoErrors(innerError, outerError) {
      if (innerError && outerError && innerError !== outerError) {
        if (Array.isArray(outerError.errors)) {
          outerError.errors.push(innerError);
          return outerError;
        }
        const err = new AggregateError([outerError, innerError], outerError.message);
        err.code = outerError.code;
        return err;
      }
      return innerError || outerError;
    }
    var AbortError = class extends Error {
      constructor(message = "The operation was aborted", options = void 0) {
        if (options !== void 0 && typeof options !== "object") {
          throw new codes.ERR_INVALID_ARG_TYPE("options", "Object", options);
        }
        super(message, options);
        this.code = "ABORT_ERR";
        this.name = "AbortError";
      }
    };
    E("ERR_ASSERTION", "%s", Error);
    E(
      "ERR_INVALID_ARG_TYPE",
      (name, expected, actual) => {
        assert(typeof name === "string", "'name' must be a string");
        if (!Array.isArray(expected)) {
          expected = [expected];
        }
        let msg = "The ";
        if (name.endsWith(" argument")) {
          msg += `${name} `;
        } else {
          msg += `"${name}" ${name.includes(".") ? "property" : "argument"} `;
        }
        msg += "must be ";
        const types = [];
        const instances = [];
        const other = [];
        for (const value of expected) {
          assert(typeof value === "string", "All expected entries have to be of type string");
          if (kTypes.includes(value)) {
            types.push(value.toLowerCase());
          } else if (classRegExp.test(value)) {
            instances.push(value);
          } else {
            assert(value !== "object", 'The value "object" should be written as "Object"');
            other.push(value);
          }
        }
        if (instances.length > 0) {
          const pos = types.indexOf("object");
          if (pos !== -1) {
            types.splice(types, pos, 1);
            instances.push("Object");
          }
        }
        if (types.length > 0) {
          switch (types.length) {
            case 1:
              msg += `of type ${types[0]}`;
              break;
            case 2:
              msg += `one of type ${types[0]} or ${types[1]}`;
              break;
            default: {
              const last = types.pop();
              msg += `one of type ${types.join(", ")}, or ${last}`;
            }
          }
          if (instances.length > 0 || other.length > 0) {
            msg += " or ";
          }
        }
        if (instances.length > 0) {
          switch (instances.length) {
            case 1:
              msg += `an instance of ${instances[0]}`;
              break;
            case 2:
              msg += `an instance of ${instances[0]} or ${instances[1]}`;
              break;
            default: {
              const last = instances.pop();
              msg += `an instance of ${instances.join(", ")}, or ${last}`;
            }
          }
          if (other.length > 0) {
            msg += " or ";
          }
        }
        switch (other.length) {
          case 0:
            break;
          case 1:
            if (other[0].toLowerCase() !== other[0]) {
              msg += "an ";
            }
            msg += `${other[0]}`;
            break;
          case 2:
            msg += `one of ${other[0]} or ${other[1]}`;
            break;
          default: {
            const last = other.pop();
            msg += `one of ${other.join(", ")}, or ${last}`;
          }
        }
        if (actual == null) {
          msg += `. Received ${actual}`;
        } else if (typeof actual === "function" && actual.name) {
          msg += `. Received function ${actual.name}`;
        } else if (typeof actual === "object") {
          var _actual$constructor;
          if ((_actual$constructor = actual.constructor) !== null && _actual$constructor !== void 0 && _actual$constructor.name) {
            msg += `. Received an instance of ${actual.constructor.name}`;
          } else {
            const inspected = inspect2(actual, {
              depth: -1
            });
            msg += `. Received ${inspected}`;
          }
        } else {
          let inspected = inspect2(actual, {
            colors: false
          });
          if (inspected.length > 25) {
            inspected = `${inspected.slice(0, 25)}...`;
          }
          msg += `. Received type ${typeof actual} (${inspected})`;
        }
        return msg;
      },
      TypeError
    );
    E(
      "ERR_INVALID_ARG_VALUE",
      (name, value, reason = "is invalid") => {
        let inspected = inspect2(value);
        if (inspected.length > 128) {
          inspected = inspected.slice(0, 128) + "...";
        }
        const type = name.includes(".") ? "property" : "argument";
        return `The ${type} '${name}' ${reason}. Received ${inspected}`;
      },
      TypeError
    );
    E(
      "ERR_INVALID_RETURN_VALUE",
      (input, name, value) => {
        var _value$constructor;
        const type = value !== null && value !== void 0 && (_value$constructor = value.constructor) !== null && _value$constructor !== void 0 && _value$constructor.name ? `instance of ${value.constructor.name}` : `type ${typeof value}`;
        return `Expected ${input} to be returned from the "${name}" function but got ${type}.`;
      },
      TypeError
    );
    E(
      "ERR_MISSING_ARGS",
      (...args) => {
        assert(args.length > 0, "At least one arg needs to be specified");
        let msg;
        const len = args.length;
        args = (Array.isArray(args) ? args : [args]).map((a2) => `"${a2}"`).join(" or ");
        switch (len) {
          case 1:
            msg += `The ${args[0]} argument`;
            break;
          case 2:
            msg += `The ${args[0]} and ${args[1]} arguments`;
            break;
          default:
            {
              const last = args.pop();
              msg += `The ${args.join(", ")}, and ${last} arguments`;
            }
            break;
        }
        return `${msg} must be specified`;
      },
      TypeError
    );
    E(
      "ERR_OUT_OF_RANGE",
      (str, range, input) => {
        assert(range, 'Missing "range" argument');
        let received;
        if (Number.isInteger(input) && Math.abs(input) > 2 ** 32) {
          received = addNumericalSeparator(String(input));
        } else if (typeof input === "bigint") {
          received = String(input);
          const limit = BigInt(2) ** BigInt(32);
          if (input > limit || input < -limit) {
            received = addNumericalSeparator(received);
          }
          received += "n";
        } else {
          received = inspect2(input);
        }
        return `The value of "${str}" is out of range. It must be ${range}. Received ${received}`;
      },
      RangeError
    );
    E("ERR_MULTIPLE_CALLBACK", "Callback called multiple times", Error);
    E("ERR_METHOD_NOT_IMPLEMENTED", "The %s method is not implemented", Error);
    E("ERR_STREAM_ALREADY_FINISHED", "Cannot call %s after a stream was finished", Error);
    E("ERR_STREAM_CANNOT_PIPE", "Cannot pipe, not readable", Error);
    E("ERR_STREAM_DESTROYED", "Cannot call %s after a stream was destroyed", Error);
    E("ERR_STREAM_NULL_VALUES", "May not write null values to stream", TypeError);
    E("ERR_STREAM_PREMATURE_CLOSE", "Premature close", Error);
    E("ERR_STREAM_PUSH_AFTER_EOF", "stream.push() after EOF", Error);
    E("ERR_STREAM_UNSHIFT_AFTER_END_EVENT", "stream.unshift() after end event", Error);
    E("ERR_STREAM_WRITE_AFTER_END", "write after end", Error);
    E("ERR_UNKNOWN_ENCODING", "Unknown encoding: %s", TypeError);
    module.exports = {
      AbortError,
      aggregateTwoErrors: hideStackFrames(aggregateTwoErrors),
      hideStackFrames,
      codes
    };
  }
});

// node_modules/abort-controller/browser.js
var require_browser = __commonJS({
  "node_modules/abort-controller/browser.js"(exports, module) {
    "use strict";
    var { AbortController: AbortController2, AbortSignal } = typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : (
      /* otherwise */
      void 0
    );
    module.exports = AbortController2;
    module.exports.AbortSignal = AbortSignal;
    module.exports.default = AbortController2;
  }
});

// node_modules/events/events.js
var require_events = __commonJS({
  "node_modules/events/events.js"(exports, module) {
    "use strict";
    var R = typeof Reflect === "object" ? Reflect : null;
    var ReflectApply = R && typeof R.apply === "function" ? R.apply : function ReflectApply2(target, receiver, args) {
      return Function.prototype.apply.call(target, receiver, args);
    };
    var ReflectOwnKeys;
    if (R && typeof R.ownKeys === "function") {
      ReflectOwnKeys = R.ownKeys;
    } else if (Object.getOwnPropertySymbols) {
      ReflectOwnKeys = function ReflectOwnKeys2(target) {
        return Object.getOwnPropertyNames(target).concat(Object.getOwnPropertySymbols(target));
      };
    } else {
      ReflectOwnKeys = function ReflectOwnKeys2(target) {
        return Object.getOwnPropertyNames(target);
      };
    }
    function ProcessEmitWarning(warning) {
      if (console && console.warn) console.warn(warning);
    }
    var NumberIsNaN = Number.isNaN || function NumberIsNaN2(value) {
      return value !== value;
    };
    function EventEmitter() {
      EventEmitter.init.call(this);
    }
    module.exports = EventEmitter;
    module.exports.once = once;
    EventEmitter.EventEmitter = EventEmitter;
    EventEmitter.prototype._events = void 0;
    EventEmitter.prototype._eventsCount = 0;
    EventEmitter.prototype._maxListeners = void 0;
    var defaultMaxListeners = 10;
    function checkListener(listener) {
      if (typeof listener !== "function") {
        throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
      }
    }
    Object.defineProperty(EventEmitter, "defaultMaxListeners", {
      enumerable: true,
      get: function() {
        return defaultMaxListeners;
      },
      set: function(arg) {
        if (typeof arg !== "number" || arg < 0 || NumberIsNaN(arg)) {
          throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + arg + ".");
        }
        defaultMaxListeners = arg;
      }
    });
    EventEmitter.init = function() {
      if (this._events === void 0 || this._events === Object.getPrototypeOf(this)._events) {
        this._events = /* @__PURE__ */ Object.create(null);
        this._eventsCount = 0;
      }
      this._maxListeners = this._maxListeners || void 0;
    };
    EventEmitter.prototype.setMaxListeners = function setMaxListeners(n2) {
      if (typeof n2 !== "number" || n2 < 0 || NumberIsNaN(n2)) {
        throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n2 + ".");
      }
      this._maxListeners = n2;
      return this;
    };
    function _getMaxListeners(that) {
      if (that._maxListeners === void 0)
        return EventEmitter.defaultMaxListeners;
      return that._maxListeners;
    }
    EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
      return _getMaxListeners(this);
    };
    EventEmitter.prototype.emit = function emit(type) {
      var args = [];
      for (var i2 = 1; i2 < arguments.length; i2++) args.push(arguments[i2]);
      var doError = type === "error";
      var events = this._events;
      if (events !== void 0)
        doError = doError && events.error === void 0;
      else if (!doError)
        return false;
      if (doError) {
        var er;
        if (args.length > 0)
          er = args[0];
        if (er instanceof Error) {
          throw er;
        }
        var err = new Error("Unhandled error." + (er ? " (" + er.message + ")" : ""));
        err.context = er;
        throw err;
      }
      var handler2 = events[type];
      if (handler2 === void 0)
        return false;
      if (typeof handler2 === "function") {
        ReflectApply(handler2, this, args);
      } else {
        var len = handler2.length;
        var listeners = arrayClone(handler2, len);
        for (var i2 = 0; i2 < len; ++i2)
          ReflectApply(listeners[i2], this, args);
      }
      return true;
    };
    function _addListener(target, type, listener, prepend) {
      var m;
      var events;
      var existing;
      checkListener(listener);
      events = target._events;
      if (events === void 0) {
        events = target._events = /* @__PURE__ */ Object.create(null);
        target._eventsCount = 0;
      } else {
        if (events.newListener !== void 0) {
          target.emit(
            "newListener",
            type,
            listener.listener ? listener.listener : listener
          );
          events = target._events;
        }
        existing = events[type];
      }
      if (existing === void 0) {
        existing = events[type] = listener;
        ++target._eventsCount;
      } else {
        if (typeof existing === "function") {
          existing = events[type] = prepend ? [listener, existing] : [existing, listener];
        } else if (prepend) {
          existing.unshift(listener);
        } else {
          existing.push(listener);
        }
        m = _getMaxListeners(target);
        if (m > 0 && existing.length > m && !existing.warned) {
          existing.warned = true;
          var w = new Error("Possible EventEmitter memory leak detected. " + existing.length + " " + String(type) + " listeners added. Use emitter.setMaxListeners() to increase limit");
          w.name = "MaxListenersExceededWarning";
          w.emitter = target;
          w.type = type;
          w.count = existing.length;
          ProcessEmitWarning(w);
        }
      }
      return target;
    }
    EventEmitter.prototype.addListener = function addListener(type, listener) {
      return _addListener(this, type, listener, false);
    };
    EventEmitter.prototype.on = EventEmitter.prototype.addListener;
    EventEmitter.prototype.prependListener = function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };
    function onceWrapper() {
      if (!this.fired) {
        this.target.removeListener(this.type, this.wrapFn);
        this.fired = true;
        if (arguments.length === 0)
          return this.listener.call(this.target);
        return this.listener.apply(this.target, arguments);
      }
    }
    function _onceWrap(target, type, listener) {
      var state = { fired: false, wrapFn: void 0, target, type, listener };
      var wrapped = onceWrapper.bind(state);
      wrapped.listener = listener;
      state.wrapFn = wrapped;
      return wrapped;
    }
    EventEmitter.prototype.once = function once2(type, listener) {
      checkListener(listener);
      this.on(type, _onceWrap(this, type, listener));
      return this;
    };
    EventEmitter.prototype.prependOnceListener = function prependOnceListener(type, listener) {
      checkListener(listener);
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };
    EventEmitter.prototype.removeListener = function removeListener(type, listener) {
      var list, events, position, i2, originalListener;
      checkListener(listener);
      events = this._events;
      if (events === void 0)
        return this;
      list = events[type];
      if (list === void 0)
        return this;
      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0)
          this._events = /* @__PURE__ */ Object.create(null);
        else {
          delete events[type];
          if (events.removeListener)
            this.emit("removeListener", type, list.listener || listener);
        }
      } else if (typeof list !== "function") {
        position = -1;
        for (i2 = list.length - 1; i2 >= 0; i2--) {
          if (list[i2] === listener || list[i2].listener === listener) {
            originalListener = list[i2].listener;
            position = i2;
            break;
          }
        }
        if (position < 0)
          return this;
        if (position === 0)
          list.shift();
        else {
          spliceOne(list, position);
        }
        if (list.length === 1)
          events[type] = list[0];
        if (events.removeListener !== void 0)
          this.emit("removeListener", type, originalListener || listener);
      }
      return this;
    };
    EventEmitter.prototype.off = EventEmitter.prototype.removeListener;
    EventEmitter.prototype.removeAllListeners = function removeAllListeners(type) {
      var listeners, events, i2;
      events = this._events;
      if (events === void 0)
        return this;
      if (events.removeListener === void 0) {
        if (arguments.length === 0) {
          this._events = /* @__PURE__ */ Object.create(null);
          this._eventsCount = 0;
        } else if (events[type] !== void 0) {
          if (--this._eventsCount === 0)
            this._events = /* @__PURE__ */ Object.create(null);
          else
            delete events[type];
        }
        return this;
      }
      if (arguments.length === 0) {
        var keys = Object.keys(events);
        var key;
        for (i2 = 0; i2 < keys.length; ++i2) {
          key = keys[i2];
          if (key === "removeListener") continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners("removeListener");
        this._events = /* @__PURE__ */ Object.create(null);
        this._eventsCount = 0;
        return this;
      }
      listeners = events[type];
      if (typeof listeners === "function") {
        this.removeListener(type, listeners);
      } else if (listeners !== void 0) {
        for (i2 = listeners.length - 1; i2 >= 0; i2--) {
          this.removeListener(type, listeners[i2]);
        }
      }
      return this;
    };
    function _listeners(target, type, unwrap) {
      var events = target._events;
      if (events === void 0)
        return [];
      var evlistener = events[type];
      if (evlistener === void 0)
        return [];
      if (typeof evlistener === "function")
        return unwrap ? [evlistener.listener || evlistener] : [evlistener];
      return unwrap ? unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
    }
    EventEmitter.prototype.listeners = function listeners(type) {
      return _listeners(this, type, true);
    };
    EventEmitter.prototype.rawListeners = function rawListeners(type) {
      return _listeners(this, type, false);
    };
    EventEmitter.listenerCount = function(emitter, type) {
      if (typeof emitter.listenerCount === "function") {
        return emitter.listenerCount(type);
      } else {
        return listenerCount.call(emitter, type);
      }
    };
    EventEmitter.prototype.listenerCount = listenerCount;
    function listenerCount(type) {
      var events = this._events;
      if (events !== void 0) {
        var evlistener = events[type];
        if (typeof evlistener === "function") {
          return 1;
        } else if (evlistener !== void 0) {
          return evlistener.length;
        }
      }
      return 0;
    }
    EventEmitter.prototype.eventNames = function eventNames() {
      return this._eventsCount > 0 ? ReflectOwnKeys(this._events) : [];
    };
    function arrayClone(arr, n2) {
      var copy = new Array(n2);
      for (var i2 = 0; i2 < n2; ++i2)
        copy[i2] = arr[i2];
      return copy;
    }
    function spliceOne(list, index) {
      for (; index + 1 < list.length; index++)
        list[index] = list[index + 1];
      list.pop();
    }
    function unwrapListeners(arr) {
      var ret = new Array(arr.length);
      for (var i2 = 0; i2 < ret.length; ++i2) {
        ret[i2] = arr[i2].listener || arr[i2];
      }
      return ret;
    }
    function once(emitter, name) {
      return new Promise(function(resolve, reject) {
        function errorListener(err) {
          emitter.removeListener(name, resolver);
          reject(err);
        }
        function resolver() {
          if (typeof emitter.removeListener === "function") {
            emitter.removeListener("error", errorListener);
          }
          resolve([].slice.call(arguments));
        }
        ;
        eventTargetAgnosticAddListener(emitter, name, resolver, { once: true });
        if (name !== "error") {
          addErrorHandlerIfEventEmitter(emitter, errorListener, { once: true });
        }
      });
    }
    function addErrorHandlerIfEventEmitter(emitter, handler2, flags) {
      if (typeof emitter.on === "function") {
        eventTargetAgnosticAddListener(emitter, "error", handler2, flags);
      }
    }
    function eventTargetAgnosticAddListener(emitter, name, listener, flags) {
      if (typeof emitter.on === "function") {
        if (flags.once) {
          emitter.once(name, listener);
        } else {
          emitter.on(name, listener);
        }
      } else if (typeof emitter.addEventListener === "function") {
        emitter.addEventListener(name, function wrapListener(arg) {
          if (flags.once) {
            emitter.removeEventListener(name, wrapListener);
          }
          listener(arg);
        });
      } else {
        throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type ' + typeof emitter);
      }
    }
  }
});

// node_modules/readable-stream/lib/ours/util.js
var require_util = __commonJS({
  "node_modules/readable-stream/lib/ours/util.js"(exports, module) {
    "use strict";
    var bufferModule = require_buffer();
    var { format, inspect: inspect2 } = require_inspect();
    var {
      codes: { ERR_INVALID_ARG_TYPE }
    } = require_errors();
    var { kResistStopPropagation, AggregateError, SymbolDispose } = require_primordials();
    var AbortSignal = globalThis.AbortSignal || require_browser().AbortSignal;
    var AbortController2 = globalThis.AbortController || require_browser().AbortController;
    var AsyncFunction = Object.getPrototypeOf(async function() {
    }).constructor;
    var Blob2 = globalThis.Blob || bufferModule.Blob;
    var isBlob = typeof Blob2 !== "undefined" ? function isBlob2(b) {
      return b instanceof Blob2;
    } : function isBlob2(b) {
      return false;
    };
    var validateAbortSignal = (signal, name) => {
      if (signal !== void 0 && (signal === null || typeof signal !== "object" || !("aborted" in signal))) {
        throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
      }
    };
    var validateFunction = (value, name) => {
      if (typeof value !== "function") {
        throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
      }
    };
    module.exports = {
      AggregateError,
      kEmptyObject: Object.freeze({}),
      once(callback) {
        let called = false;
        return function(...args) {
          if (called) {
            return;
          }
          called = true;
          callback.apply(this, args);
        };
      },
      createDeferredPromise: function() {
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        });
        return {
          promise,
          resolve,
          reject
        };
      },
      promisify(fn) {
        return new Promise((resolve, reject) => {
          fn((err, ...args) => {
            if (err) {
              return reject(err);
            }
            return resolve(...args);
          });
        });
      },
      debuglog() {
        return function() {
        };
      },
      format,
      inspect: inspect2,
      types: {
        isAsyncFunction(fn) {
          return fn instanceof AsyncFunction;
        },
        isArrayBufferView(arr) {
          return ArrayBuffer.isView(arr);
        }
      },
      isBlob,
      deprecate(fn, message) {
        return fn;
      },
      addAbortListener: require_events().addAbortListener || function addAbortListener(signal, listener) {
        if (signal === void 0) {
          throw new ERR_INVALID_ARG_TYPE("signal", "AbortSignal", signal);
        }
        validateAbortSignal(signal, "signal");
        validateFunction(listener, "listener");
        let removeEventListener;
        if (signal.aborted) {
          queueMicrotask(() => listener());
        } else {
          signal.addEventListener("abort", listener, {
            __proto__: null,
            once: true,
            [kResistStopPropagation]: true
          });
          removeEventListener = () => {
            signal.removeEventListener("abort", listener);
          };
        }
        return {
          __proto__: null,
          [SymbolDispose]() {
            var _removeEventListener;
            (_removeEventListener = removeEventListener) === null || _removeEventListener === void 0 ? void 0 : _removeEventListener();
          }
        };
      },
      AbortSignalAny: AbortSignal.any || function AbortSignalAny(signals) {
        if (signals.length === 1) {
          return signals[0];
        }
        const ac = new AbortController2();
        const abort = () => ac.abort();
        signals.forEach((signal) => {
          validateAbortSignal(signal, "signals");
          signal.addEventListener("abort", abort, {
            once: true
          });
        });
        ac.signal.addEventListener(
          "abort",
          () => {
            signals.forEach((signal) => signal.removeEventListener("abort", abort));
          },
          {
            once: true
          }
        );
        return ac.signal;
      }
    };
    module.exports.promisify.custom = /* @__PURE__ */ Symbol.for("nodejs.util.promisify.custom");
  }
});

// node_modules/readable-stream/lib/internal/validators.js
var require_validators = __commonJS({
  "node_modules/readable-stream/lib/internal/validators.js"(exports, module) {
    "use strict";
    var {
      ArrayIsArray,
      ArrayPrototypeIncludes,
      ArrayPrototypeJoin,
      ArrayPrototypeMap,
      NumberIsInteger,
      NumberIsNaN,
      NumberMAX_SAFE_INTEGER,
      NumberMIN_SAFE_INTEGER,
      NumberParseInt,
      ObjectPrototypeHasOwnProperty,
      RegExpPrototypeExec,
      String: String2,
      StringPrototypeToUpperCase,
      StringPrototypeTrim
    } = require_primordials();
    var {
      hideStackFrames,
      codes: { ERR_SOCKET_BAD_PORT, ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE, ERR_OUT_OF_RANGE, ERR_UNKNOWN_SIGNAL }
    } = require_errors();
    var { normalizeEncoding } = require_util();
    var { isAsyncFunction, isArrayBufferView } = require_util().types;
    var signals = {};
    function isInt32(value) {
      return value === (value | 0);
    }
    function isUint32(value) {
      return value === value >>> 0;
    }
    var octalReg = /^[0-7]+$/;
    var modeDesc = "must be a 32-bit unsigned integer or an octal string";
    function parseFileMode(value, name, def) {
      if (typeof value === "undefined") {
        value = def;
      }
      if (typeof value === "string") {
        if (RegExpPrototypeExec(octalReg, value) === null) {
          throw new ERR_INVALID_ARG_VALUE(name, value, modeDesc);
        }
        value = NumberParseInt(value, 8);
      }
      validateUint32(value, name);
      return value;
    }
    var validateInteger = hideStackFrames((value, name, min = NumberMIN_SAFE_INTEGER, max = NumberMAX_SAFE_INTEGER) => {
      if (typeof value !== "number") throw new ERR_INVALID_ARG_TYPE(name, "number", value);
      if (!NumberIsInteger(value)) throw new ERR_OUT_OF_RANGE(name, "an integer", value);
      if (value < min || value > max) throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
    });
    var validateInt32 = hideStackFrames((value, name, min = -2147483648, max = 2147483647) => {
      if (typeof value !== "number") {
        throw new ERR_INVALID_ARG_TYPE(name, "number", value);
      }
      if (!NumberIsInteger(value)) {
        throw new ERR_OUT_OF_RANGE(name, "an integer", value);
      }
      if (value < min || value > max) {
        throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
      }
    });
    var validateUint32 = hideStackFrames((value, name, positive = false) => {
      if (typeof value !== "number") {
        throw new ERR_INVALID_ARG_TYPE(name, "number", value);
      }
      if (!NumberIsInteger(value)) {
        throw new ERR_OUT_OF_RANGE(name, "an integer", value);
      }
      const min = positive ? 1 : 0;
      const max = 4294967295;
      if (value < min || value > max) {
        throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
      }
    });
    function validateString(value, name) {
      if (typeof value !== "string") throw new ERR_INVALID_ARG_TYPE(name, "string", value);
    }
    function validateNumber(value, name, min = void 0, max) {
      if (typeof value !== "number") throw new ERR_INVALID_ARG_TYPE(name, "number", value);
      if (min != null && value < min || max != null && value > max || (min != null || max != null) && NumberIsNaN(value)) {
        throw new ERR_OUT_OF_RANGE(
          name,
          `${min != null ? `>= ${min}` : ""}${min != null && max != null ? " && " : ""}${max != null ? `<= ${max}` : ""}`,
          value
        );
      }
    }
    var validateOneOf = hideStackFrames((value, name, oneOf) => {
      if (!ArrayPrototypeIncludes(oneOf, value)) {
        const allowed = ArrayPrototypeJoin(
          ArrayPrototypeMap(oneOf, (v) => typeof v === "string" ? `'${v}'` : String2(v)),
          ", "
        );
        const reason = "must be one of: " + allowed;
        throw new ERR_INVALID_ARG_VALUE(name, value, reason);
      }
    });
    function validateBoolean(value, name) {
      if (typeof value !== "boolean") throw new ERR_INVALID_ARG_TYPE(name, "boolean", value);
    }
    function getOwnPropertyValueOrDefault(options, key, defaultValue) {
      return options == null || !ObjectPrototypeHasOwnProperty(options, key) ? defaultValue : options[key];
    }
    var validateObject = hideStackFrames((value, name, options = null) => {
      const allowArray = getOwnPropertyValueOrDefault(options, "allowArray", false);
      const allowFunction = getOwnPropertyValueOrDefault(options, "allowFunction", false);
      const nullable = getOwnPropertyValueOrDefault(options, "nullable", false);
      if (!nullable && value === null || !allowArray && ArrayIsArray(value) || typeof value !== "object" && (!allowFunction || typeof value !== "function")) {
        throw new ERR_INVALID_ARG_TYPE(name, "Object", value);
      }
    });
    var validateDictionary = hideStackFrames((value, name) => {
      if (value != null && typeof value !== "object" && typeof value !== "function") {
        throw new ERR_INVALID_ARG_TYPE(name, "a dictionary", value);
      }
    });
    var validateArray = hideStackFrames((value, name, minLength = 0) => {
      if (!ArrayIsArray(value)) {
        throw new ERR_INVALID_ARG_TYPE(name, "Array", value);
      }
      if (value.length < minLength) {
        const reason = `must be longer than ${minLength}`;
        throw new ERR_INVALID_ARG_VALUE(name, value, reason);
      }
    });
    function validateStringArray(value, name) {
      validateArray(value, name);
      for (let i2 = 0; i2 < value.length; i2++) {
        validateString(value[i2], `${name}[${i2}]`);
      }
    }
    function validateBooleanArray(value, name) {
      validateArray(value, name);
      for (let i2 = 0; i2 < value.length; i2++) {
        validateBoolean(value[i2], `${name}[${i2}]`);
      }
    }
    function validateAbortSignalArray(value, name) {
      validateArray(value, name);
      for (let i2 = 0; i2 < value.length; i2++) {
        const signal = value[i2];
        const indexedName = `${name}[${i2}]`;
        if (signal == null) {
          throw new ERR_INVALID_ARG_TYPE(indexedName, "AbortSignal", signal);
        }
        validateAbortSignal(signal, indexedName);
      }
    }
    function validateSignalName(signal, name = "signal") {
      validateString(signal, name);
      if (signals[signal] === void 0) {
        if (signals[StringPrototypeToUpperCase(signal)] !== void 0) {
          throw new ERR_UNKNOWN_SIGNAL(signal + " (signals must use all capital letters)");
        }
        throw new ERR_UNKNOWN_SIGNAL(signal);
      }
    }
    var validateBuffer = hideStackFrames((buffer, name = "buffer") => {
      if (!isArrayBufferView(buffer)) {
        throw new ERR_INVALID_ARG_TYPE(name, ["Buffer", "TypedArray", "DataView"], buffer);
      }
    });
    function validateEncoding(data, encoding) {
      const normalizedEncoding = normalizeEncoding(encoding);
      const length = data.length;
      if (normalizedEncoding === "hex" && length % 2 !== 0) {
        throw new ERR_INVALID_ARG_VALUE("encoding", encoding, `is invalid for data of length ${length}`);
      }
    }
    function validatePort(port, name = "Port", allowZero = true) {
      if (typeof port !== "number" && typeof port !== "string" || typeof port === "string" && StringPrototypeTrim(port).length === 0 || +port !== +port >>> 0 || port > 65535 || port === 0 && !allowZero) {
        throw new ERR_SOCKET_BAD_PORT(name, port, allowZero);
      }
      return port | 0;
    }
    var validateAbortSignal = hideStackFrames((signal, name) => {
      if (signal !== void 0 && (signal === null || typeof signal !== "object" || !("aborted" in signal))) {
        throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
      }
    });
    var validateFunction = hideStackFrames((value, name) => {
      if (typeof value !== "function") throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
    });
    var validatePlainFunction = hideStackFrames((value, name) => {
      if (typeof value !== "function" || isAsyncFunction(value)) throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
    });
    var validateUndefined = hideStackFrames((value, name) => {
      if (value !== void 0) throw new ERR_INVALID_ARG_TYPE(name, "undefined", value);
    });
    function validateUnion(value, name, union) {
      if (!ArrayPrototypeIncludes(union, value)) {
        throw new ERR_INVALID_ARG_TYPE(name, `('${ArrayPrototypeJoin(union, "|")}')`, value);
      }
    }
    var linkValueRegExp = /^(?:<[^>]*>)(?:\s*;\s*[^;"\s]+(?:=(")?[^;"\s]*\1)?)*$/;
    function validateLinkHeaderFormat(value, name) {
      if (typeof value === "undefined" || !RegExpPrototypeExec(linkValueRegExp, value)) {
        throw new ERR_INVALID_ARG_VALUE(
          name,
          value,
          'must be an array or string of format "</styles.css>; rel=preload; as=style"'
        );
      }
    }
    function validateLinkHeaderValue(hints) {
      if (typeof hints === "string") {
        validateLinkHeaderFormat(hints, "hints");
        return hints;
      } else if (ArrayIsArray(hints)) {
        const hintsLength = hints.length;
        let result = "";
        if (hintsLength === 0) {
          return result;
        }
        for (let i2 = 0; i2 < hintsLength; i2++) {
          const link = hints[i2];
          validateLinkHeaderFormat(link, "hints");
          result += link;
          if (i2 !== hintsLength - 1) {
            result += ", ";
          }
        }
        return result;
      }
      throw new ERR_INVALID_ARG_VALUE(
        "hints",
        hints,
        'must be an array or string of format "</styles.css>; rel=preload; as=style"'
      );
    }
    module.exports = {
      isInt32,
      isUint32,
      parseFileMode,
      validateArray,
      validateStringArray,
      validateBooleanArray,
      validateAbortSignalArray,
      validateBoolean,
      validateBuffer,
      validateDictionary,
      validateEncoding,
      validateFunction,
      validateInt32,
      validateInteger,
      validateNumber,
      validateObject,
      validateOneOf,
      validatePlainFunction,
      validatePort,
      validateSignalName,
      validateString,
      validateUint32,
      validateUndefined,
      validateUnion,
      validateAbortSignal,
      validateLinkHeaderValue
    };
  }
});

// node_modules/process/browser.js
var require_browser2 = __commonJS({
  "node_modules/process/browser.js"(exports, module) {
    var process2 = module.exports = {};
    var cachedSetTimeout;
    var cachedClearTimeout;
    function defaultSetTimout() {
      throw new Error("setTimeout has not been defined");
    }
    function defaultClearTimeout() {
      throw new Error("clearTimeout has not been defined");
    }
    (function() {
      try {
        if (typeof setTimeout === "function") {
          cachedSetTimeout = setTimeout;
        } else {
          cachedSetTimeout = defaultSetTimout;
        }
      } catch (e) {
        cachedSetTimeout = defaultSetTimout;
      }
      try {
        if (typeof clearTimeout === "function") {
          cachedClearTimeout = clearTimeout;
        } else {
          cachedClearTimeout = defaultClearTimeout;
        }
      } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
      }
    })();
    function runTimeout(fun) {
      if (cachedSetTimeout === setTimeout) {
        return setTimeout(fun, 0);
      }
      if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
      }
      try {
        return cachedSetTimeout(fun, 0);
      } catch (e) {
        try {
          return cachedSetTimeout.call(null, fun, 0);
        } catch (e2) {
          return cachedSetTimeout.call(this, fun, 0);
        }
      }
    }
    function runClearTimeout(marker) {
      if (cachedClearTimeout === clearTimeout) {
        return clearTimeout(marker);
      }
      if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
      }
      try {
        return cachedClearTimeout(marker);
      } catch (e) {
        try {
          return cachedClearTimeout.call(null, marker);
        } catch (e2) {
          return cachedClearTimeout.call(this, marker);
        }
      }
    }
    var queue = [];
    var draining = false;
    var currentQueue;
    var queueIndex = -1;
    function cleanUpNextTick() {
      if (!draining || !currentQueue) {
        return;
      }
      draining = false;
      if (currentQueue.length) {
        queue = currentQueue.concat(queue);
      } else {
        queueIndex = -1;
      }
      if (queue.length) {
        drainQueue();
      }
    }
    function drainQueue() {
      if (draining) {
        return;
      }
      var timeout = runTimeout(cleanUpNextTick);
      draining = true;
      var len = queue.length;
      while (len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
          if (currentQueue) {
            currentQueue[queueIndex].run();
          }
        }
        queueIndex = -1;
        len = queue.length;
      }
      currentQueue = null;
      draining = false;
      runClearTimeout(timeout);
    }
    process2.nextTick = function(fun) {
      var args = new Array(arguments.length - 1);
      if (arguments.length > 1) {
        for (var i2 = 1; i2 < arguments.length; i2++) {
          args[i2 - 1] = arguments[i2];
        }
      }
      queue.push(new Item(fun, args));
      if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
      }
    };
    function Item(fun, array) {
      this.fun = fun;
      this.array = array;
    }
    Item.prototype.run = function() {
      this.fun.apply(null, this.array);
    };
    process2.title = "browser";
    process2.browser = true;
    process2.env = {};
    process2.argv = [];
    process2.version = "";
    process2.versions = {};
    function noop2() {
    }
    process2.on = noop2;
    process2.addListener = noop2;
    process2.once = noop2;
    process2.off = noop2;
    process2.removeListener = noop2;
    process2.removeAllListeners = noop2;
    process2.emit = noop2;
    process2.prependListener = noop2;
    process2.prependOnceListener = noop2;
    process2.listeners = function(name) {
      return [];
    };
    process2.binding = function(name) {
      throw new Error("process.binding is not supported");
    };
    process2.cwd = function() {
      return "/";
    };
    process2.chdir = function(dir) {
      throw new Error("process.chdir is not supported");
    };
    process2.umask = function() {
      return 0;
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/utils.js
var require_utils = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/utils.js"(exports, module) {
    "use strict";
    var { SymbolAsyncIterator, SymbolIterator, SymbolFor } = require_primordials();
    var kIsDestroyed = SymbolFor("nodejs.stream.destroyed");
    var kIsErrored = SymbolFor("nodejs.stream.errored");
    var kIsReadable = SymbolFor("nodejs.stream.readable");
    var kIsWritable = SymbolFor("nodejs.stream.writable");
    var kIsDisturbed = SymbolFor("nodejs.stream.disturbed");
    var kIsClosedPromise = SymbolFor("nodejs.webstream.isClosedPromise");
    var kControllerErrorFunction = SymbolFor("nodejs.webstream.controllerErrorFunction");
    function isReadableNodeStream(obj, strict111 = false) {
      var _obj$_readableState;
      return !!(obj && typeof obj.pipe === "function" && typeof obj.on === "function" && (!strict111 || typeof obj.pause === "function" && typeof obj.resume === "function") && (!obj._writableState || ((_obj$_readableState = obj._readableState) === null || _obj$_readableState === void 0 ? void 0 : _obj$_readableState.readable) !== false) && // Duplex
      (!obj._writableState || obj._readableState));
    }
    function isWritableNodeStream(obj) {
      var _obj$_writableState;
      return !!(obj && typeof obj.write === "function" && typeof obj.on === "function" && (!obj._readableState || ((_obj$_writableState = obj._writableState) === null || _obj$_writableState === void 0 ? void 0 : _obj$_writableState.writable) !== false));
    }
    function isDuplexNodeStream(obj) {
      return !!(obj && typeof obj.pipe === "function" && obj._readableState && typeof obj.on === "function" && typeof obj.write === "function");
    }
    function isNodeStream(obj) {
      return obj && (obj._readableState || obj._writableState || typeof obj.write === "function" && typeof obj.on === "function" || typeof obj.pipe === "function" && typeof obj.on === "function");
    }
    function isReadableStream2(obj) {
      return !!(obj && !isNodeStream(obj) && typeof obj.pipeThrough === "function" && typeof obj.getReader === "function" && typeof obj.cancel === "function");
    }
    function isWritableStream(obj) {
      return !!(obj && !isNodeStream(obj) && typeof obj.getWriter === "function" && typeof obj.abort === "function");
    }
    function isTransformStream(obj) {
      return !!(obj && !isNodeStream(obj) && typeof obj.readable === "object" && typeof obj.writable === "object");
    }
    function isWebStream(obj) {
      return isReadableStream2(obj) || isWritableStream(obj) || isTransformStream(obj);
    }
    function isIterable(obj, isAsync) {
      if (obj == null) return false;
      if (isAsync === true) return typeof obj[SymbolAsyncIterator] === "function";
      if (isAsync === false) return typeof obj[SymbolIterator] === "function";
      return typeof obj[SymbolAsyncIterator] === "function" || typeof obj[SymbolIterator] === "function";
    }
    function isDestroyed(stream) {
      if (!isNodeStream(stream)) return null;
      const wState = stream._writableState;
      const rState = stream._readableState;
      const state = wState || rState;
      return !!(stream.destroyed || stream[kIsDestroyed] || state !== null && state !== void 0 && state.destroyed);
    }
    function isWritableEnded(stream) {
      if (!isWritableNodeStream(stream)) return null;
      if (stream.writableEnded === true) return true;
      const wState = stream._writableState;
      if (wState !== null && wState !== void 0 && wState.errored) return false;
      if (typeof (wState === null || wState === void 0 ? void 0 : wState.ended) !== "boolean") return null;
      return wState.ended;
    }
    function isWritableFinished(stream, strict111) {
      if (!isWritableNodeStream(stream)) return null;
      if (stream.writableFinished === true) return true;
      const wState = stream._writableState;
      if (wState !== null && wState !== void 0 && wState.errored) return false;
      if (typeof (wState === null || wState === void 0 ? void 0 : wState.finished) !== "boolean") return null;
      return !!(wState.finished || strict111 === false && wState.ended === true && wState.length === 0);
    }
    function isReadableEnded(stream) {
      if (!isReadableNodeStream(stream)) return null;
      if (stream.readableEnded === true) return true;
      const rState = stream._readableState;
      if (!rState || rState.errored) return false;
      if (typeof (rState === null || rState === void 0 ? void 0 : rState.ended) !== "boolean") return null;
      return rState.ended;
    }
    function isReadableFinished(stream, strict111) {
      if (!isReadableNodeStream(stream)) return null;
      const rState = stream._readableState;
      if (rState !== null && rState !== void 0 && rState.errored) return false;
      if (typeof (rState === null || rState === void 0 ? void 0 : rState.endEmitted) !== "boolean") return null;
      return !!(rState.endEmitted || strict111 === false && rState.ended === true && rState.length === 0);
    }
    function isReadable(stream) {
      if (stream && stream[kIsReadable] != null) return stream[kIsReadable];
      if (typeof (stream === null || stream === void 0 ? void 0 : stream.readable) !== "boolean") return null;
      if (isDestroyed(stream)) return false;
      return isReadableNodeStream(stream) && stream.readable && !isReadableFinished(stream);
    }
    function isWritable(stream) {
      if (stream && stream[kIsWritable] != null) return stream[kIsWritable];
      if (typeof (stream === null || stream === void 0 ? void 0 : stream.writable) !== "boolean") return null;
      if (isDestroyed(stream)) return false;
      return isWritableNodeStream(stream) && stream.writable && !isWritableEnded(stream);
    }
    function isFinished(stream, opts) {
      if (!isNodeStream(stream)) {
        return null;
      }
      if (isDestroyed(stream)) {
        return true;
      }
      if ((opts === null || opts === void 0 ? void 0 : opts.readable) !== false && isReadable(stream)) {
        return false;
      }
      if ((opts === null || opts === void 0 ? void 0 : opts.writable) !== false && isWritable(stream)) {
        return false;
      }
      return true;
    }
    function isWritableErrored(stream) {
      var _stream$_writableStat, _stream$_writableStat2;
      if (!isNodeStream(stream)) {
        return null;
      }
      if (stream.writableErrored) {
        return stream.writableErrored;
      }
      return (_stream$_writableStat = (_stream$_writableStat2 = stream._writableState) === null || _stream$_writableStat2 === void 0 ? void 0 : _stream$_writableStat2.errored) !== null && _stream$_writableStat !== void 0 ? _stream$_writableStat : null;
    }
    function isReadableErrored(stream) {
      var _stream$_readableStat, _stream$_readableStat2;
      if (!isNodeStream(stream)) {
        return null;
      }
      if (stream.readableErrored) {
        return stream.readableErrored;
      }
      return (_stream$_readableStat = (_stream$_readableStat2 = stream._readableState) === null || _stream$_readableStat2 === void 0 ? void 0 : _stream$_readableStat2.errored) !== null && _stream$_readableStat !== void 0 ? _stream$_readableStat : null;
    }
    function isClosed(stream) {
      if (!isNodeStream(stream)) {
        return null;
      }
      if (typeof stream.closed === "boolean") {
        return stream.closed;
      }
      const wState = stream._writableState;
      const rState = stream._readableState;
      if (typeof (wState === null || wState === void 0 ? void 0 : wState.closed) === "boolean" || typeof (rState === null || rState === void 0 ? void 0 : rState.closed) === "boolean") {
        return (wState === null || wState === void 0 ? void 0 : wState.closed) || (rState === null || rState === void 0 ? void 0 : rState.closed);
      }
      if (typeof stream._closed === "boolean" && isOutgoingMessage(stream)) {
        return stream._closed;
      }
      return null;
    }
    function isOutgoingMessage(stream) {
      return typeof stream._closed === "boolean" && typeof stream._defaultKeepAlive === "boolean" && typeof stream._removedConnection === "boolean" && typeof stream._removedContLen === "boolean";
    }
    function isServerResponse(stream) {
      return typeof stream._sent100 === "boolean" && isOutgoingMessage(stream);
    }
    function isServerRequest(stream) {
      var _stream$req;
      return typeof stream._consuming === "boolean" && typeof stream._dumped === "boolean" && ((_stream$req = stream.req) === null || _stream$req === void 0 ? void 0 : _stream$req.upgradeOrConnect) === void 0;
    }
    function willEmitClose(stream) {
      if (!isNodeStream(stream)) return null;
      const wState = stream._writableState;
      const rState = stream._readableState;
      const state = wState || rState;
      return !state && isServerResponse(stream) || !!(state && state.autoDestroy && state.emitClose && state.closed === false);
    }
    function isDisturbed(stream) {
      var _stream$kIsDisturbed;
      return !!(stream && ((_stream$kIsDisturbed = stream[kIsDisturbed]) !== null && _stream$kIsDisturbed !== void 0 ? _stream$kIsDisturbed : stream.readableDidRead || stream.readableAborted));
    }
    function isErrored(stream) {
      var _ref, _ref2, _ref3, _ref4, _ref5, _stream$kIsErrored, _stream$_readableStat3, _stream$_writableStat3, _stream$_readableStat4, _stream$_writableStat4;
      return !!(stream && ((_ref = (_ref2 = (_ref3 = (_ref4 = (_ref5 = (_stream$kIsErrored = stream[kIsErrored]) !== null && _stream$kIsErrored !== void 0 ? _stream$kIsErrored : stream.readableErrored) !== null && _ref5 !== void 0 ? _ref5 : stream.writableErrored) !== null && _ref4 !== void 0 ? _ref4 : (_stream$_readableStat3 = stream._readableState) === null || _stream$_readableStat3 === void 0 ? void 0 : _stream$_readableStat3.errorEmitted) !== null && _ref3 !== void 0 ? _ref3 : (_stream$_writableStat3 = stream._writableState) === null || _stream$_writableStat3 === void 0 ? void 0 : _stream$_writableStat3.errorEmitted) !== null && _ref2 !== void 0 ? _ref2 : (_stream$_readableStat4 = stream._readableState) === null || _stream$_readableStat4 === void 0 ? void 0 : _stream$_readableStat4.errored) !== null && _ref !== void 0 ? _ref : (_stream$_writableStat4 = stream._writableState) === null || _stream$_writableStat4 === void 0 ? void 0 : _stream$_writableStat4.errored));
    }
    module.exports = {
      isDestroyed,
      kIsDestroyed,
      isDisturbed,
      kIsDisturbed,
      isErrored,
      kIsErrored,
      isReadable,
      kIsReadable,
      kIsClosedPromise,
      kControllerErrorFunction,
      kIsWritable,
      isClosed,
      isDuplexNodeStream,
      isFinished,
      isIterable,
      isReadableNodeStream,
      isReadableStream: isReadableStream2,
      isReadableEnded,
      isReadableFinished,
      isReadableErrored,
      isNodeStream,
      isWebStream,
      isWritable,
      isWritableNodeStream,
      isWritableStream,
      isWritableEnded,
      isWritableFinished,
      isWritableErrored,
      isServerRequest,
      isServerResponse,
      willEmitClose,
      isTransformStream
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/end-of-stream.js
var require_end_of_stream = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/end-of-stream.js"(exports, module) {
    "use strict";
    var process2 = require_browser2();
    var { AbortError, codes } = require_errors();
    var { ERR_INVALID_ARG_TYPE, ERR_STREAM_PREMATURE_CLOSE } = codes;
    var { kEmptyObject, once } = require_util();
    var { validateAbortSignal, validateFunction, validateObject, validateBoolean } = require_validators();
    var { Promise: Promise2, PromisePrototypeThen, SymbolDispose } = require_primordials();
    var {
      isClosed,
      isReadable,
      isReadableNodeStream,
      isReadableStream: isReadableStream2,
      isReadableFinished,
      isReadableErrored,
      isWritable,
      isWritableNodeStream,
      isWritableStream,
      isWritableFinished,
      isWritableErrored,
      isNodeStream,
      willEmitClose: _willEmitClose,
      kIsClosedPromise
    } = require_utils();
    var addAbortListener;
    function isRequest(stream) {
      return stream.setHeader && typeof stream.abort === "function";
    }
    var nop = () => {
    };
    function eos(stream, options, callback) {
      var _options$readable, _options$writable;
      if (arguments.length === 2) {
        callback = options;
        options = kEmptyObject;
      } else if (options == null) {
        options = kEmptyObject;
      } else {
        validateObject(options, "options");
      }
      validateFunction(callback, "callback");
      validateAbortSignal(options.signal, "options.signal");
      callback = once(callback);
      if (isReadableStream2(stream) || isWritableStream(stream)) {
        return eosWeb(stream, options, callback);
      }
      if (!isNodeStream(stream)) {
        throw new ERR_INVALID_ARG_TYPE("stream", ["ReadableStream", "WritableStream", "Stream"], stream);
      }
      const readable = (_options$readable = options.readable) !== null && _options$readable !== void 0 ? _options$readable : isReadableNodeStream(stream);
      const writable = (_options$writable = options.writable) !== null && _options$writable !== void 0 ? _options$writable : isWritableNodeStream(stream);
      const wState = stream._writableState;
      const rState = stream._readableState;
      const onlegacyfinish = () => {
        if (!stream.writable) {
          onfinish();
        }
      };
      let willEmitClose = _willEmitClose(stream) && isReadableNodeStream(stream) === readable && isWritableNodeStream(stream) === writable;
      let writableFinished = isWritableFinished(stream, false);
      const onfinish = () => {
        writableFinished = true;
        if (stream.destroyed) {
          willEmitClose = false;
        }
        if (willEmitClose && (!stream.readable || readable)) {
          return;
        }
        if (!readable || readableFinished) {
          callback.call(stream);
        }
      };
      let readableFinished = isReadableFinished(stream, false);
      const onend = () => {
        readableFinished = true;
        if (stream.destroyed) {
          willEmitClose = false;
        }
        if (willEmitClose && (!stream.writable || writable)) {
          return;
        }
        if (!writable || writableFinished) {
          callback.call(stream);
        }
      };
      const onerror = (err) => {
        callback.call(stream, err);
      };
      let closed = isClosed(stream);
      const onclose = () => {
        closed = true;
        const errored = isWritableErrored(stream) || isReadableErrored(stream);
        if (errored && typeof errored !== "boolean") {
          return callback.call(stream, errored);
        }
        if (readable && !readableFinished && isReadableNodeStream(stream, true)) {
          if (!isReadableFinished(stream, false)) return callback.call(stream, new ERR_STREAM_PREMATURE_CLOSE());
        }
        if (writable && !writableFinished) {
          if (!isWritableFinished(stream, false)) return callback.call(stream, new ERR_STREAM_PREMATURE_CLOSE());
        }
        callback.call(stream);
      };
      const onclosed = () => {
        closed = true;
        const errored = isWritableErrored(stream) || isReadableErrored(stream);
        if (errored && typeof errored !== "boolean") {
          return callback.call(stream, errored);
        }
        callback.call(stream);
      };
      const onrequest = () => {
        stream.req.on("finish", onfinish);
      };
      if (isRequest(stream)) {
        stream.on("complete", onfinish);
        if (!willEmitClose) {
          stream.on("abort", onclose);
        }
        if (stream.req) {
          onrequest();
        } else {
          stream.on("request", onrequest);
        }
      } else if (writable && !wState) {
        stream.on("end", onlegacyfinish);
        stream.on("close", onlegacyfinish);
      }
      if (!willEmitClose && typeof stream.aborted === "boolean") {
        stream.on("aborted", onclose);
      }
      stream.on("end", onend);
      stream.on("finish", onfinish);
      if (options.error !== false) {
        stream.on("error", onerror);
      }
      stream.on("close", onclose);
      if (closed) {
        process2.nextTick(onclose);
      } else if (wState !== null && wState !== void 0 && wState.errorEmitted || rState !== null && rState !== void 0 && rState.errorEmitted) {
        if (!willEmitClose) {
          process2.nextTick(onclosed);
        }
      } else if (!readable && (!willEmitClose || isReadable(stream)) && (writableFinished || isWritable(stream) === false)) {
        process2.nextTick(onclosed);
      } else if (!writable && (!willEmitClose || isWritable(stream)) && (readableFinished || isReadable(stream) === false)) {
        process2.nextTick(onclosed);
      } else if (rState && stream.req && stream.aborted) {
        process2.nextTick(onclosed);
      }
      const cleanup = () => {
        callback = nop;
        stream.removeListener("aborted", onclose);
        stream.removeListener("complete", onfinish);
        stream.removeListener("abort", onclose);
        stream.removeListener("request", onrequest);
        if (stream.req) stream.req.removeListener("finish", onfinish);
        stream.removeListener("end", onlegacyfinish);
        stream.removeListener("close", onlegacyfinish);
        stream.removeListener("finish", onfinish);
        stream.removeListener("end", onend);
        stream.removeListener("error", onerror);
        stream.removeListener("close", onclose);
      };
      if (options.signal && !closed) {
        const abort = () => {
          const endCallback = callback;
          cleanup();
          endCallback.call(
            stream,
            new AbortError(void 0, {
              cause: options.signal.reason
            })
          );
        };
        if (options.signal.aborted) {
          process2.nextTick(abort);
        } else {
          addAbortListener = addAbortListener || require_util().addAbortListener;
          const disposable = addAbortListener(options.signal, abort);
          const originalCallback = callback;
          callback = once((...args) => {
            disposable[SymbolDispose]();
            originalCallback.apply(stream, args);
          });
        }
      }
      return cleanup;
    }
    function eosWeb(stream, options, callback) {
      let isAborted = false;
      let abort = nop;
      if (options.signal) {
        abort = () => {
          isAborted = true;
          callback.call(
            stream,
            new AbortError(void 0, {
              cause: options.signal.reason
            })
          );
        };
        if (options.signal.aborted) {
          process2.nextTick(abort);
        } else {
          addAbortListener = addAbortListener || require_util().addAbortListener;
          const disposable = addAbortListener(options.signal, abort);
          const originalCallback = callback;
          callback = once((...args) => {
            disposable[SymbolDispose]();
            originalCallback.apply(stream, args);
          });
        }
      }
      const resolverFn = (...args) => {
        if (!isAborted) {
          process2.nextTick(() => callback.apply(stream, args));
        }
      };
      PromisePrototypeThen(stream[kIsClosedPromise].promise, resolverFn, resolverFn);
      return nop;
    }
    function finished(stream, opts) {
      var _opts;
      let autoCleanup = false;
      if (opts === null) {
        opts = kEmptyObject;
      }
      if ((_opts = opts) !== null && _opts !== void 0 && _opts.cleanup) {
        validateBoolean(opts.cleanup, "cleanup");
        autoCleanup = opts.cleanup;
      }
      return new Promise2((resolve, reject) => {
        const cleanup = eos(stream, opts, (err) => {
          if (autoCleanup) {
            cleanup();
          }
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }
    module.exports = eos;
    module.exports.finished = finished;
  }
});

// node_modules/readable-stream/lib/internal/streams/destroy.js
var require_destroy = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/destroy.js"(exports, module) {
    "use strict";
    var process2 = require_browser2();
    var {
      aggregateTwoErrors,
      codes: { ERR_MULTIPLE_CALLBACK },
      AbortError
    } = require_errors();
    var { Symbol: Symbol2 } = require_primordials();
    var { kIsDestroyed, isDestroyed, isFinished, isServerRequest } = require_utils();
    var kDestroy = Symbol2("kDestroy");
    var kConstruct = Symbol2("kConstruct");
    function checkError(err, w, r) {
      if (err) {
        err.stack;
        if (w && !w.errored) {
          w.errored = err;
        }
        if (r && !r.errored) {
          r.errored = err;
        }
      }
    }
    function destroy(err, cb) {
      const r = this._readableState;
      const w = this._writableState;
      const s = w || r;
      if (w !== null && w !== void 0 && w.destroyed || r !== null && r !== void 0 && r.destroyed) {
        if (typeof cb === "function") {
          cb();
        }
        return this;
      }
      checkError(err, w, r);
      if (w) {
        w.destroyed = true;
      }
      if (r) {
        r.destroyed = true;
      }
      if (!s.constructed) {
        this.once(kDestroy, function(er) {
          _destroy(this, aggregateTwoErrors(er, err), cb);
        });
      } else {
        _destroy(this, err, cb);
      }
      return this;
    }
    function _destroy(self2, err, cb) {
      let called = false;
      function onDestroy(err2) {
        if (called) {
          return;
        }
        called = true;
        const r = self2._readableState;
        const w = self2._writableState;
        checkError(err2, w, r);
        if (w) {
          w.closed = true;
        }
        if (r) {
          r.closed = true;
        }
        if (typeof cb === "function") {
          cb(err2);
        }
        if (err2) {
          process2.nextTick(emitErrorCloseNT, self2, err2);
        } else {
          process2.nextTick(emitCloseNT, self2);
        }
      }
      try {
        self2._destroy(err || null, onDestroy);
      } catch (err2) {
        onDestroy(err2);
      }
    }
    function emitErrorCloseNT(self2, err) {
      emitErrorNT(self2, err);
      emitCloseNT(self2);
    }
    function emitCloseNT(self2) {
      const r = self2._readableState;
      const w = self2._writableState;
      if (w) {
        w.closeEmitted = true;
      }
      if (r) {
        r.closeEmitted = true;
      }
      if (w !== null && w !== void 0 && w.emitClose || r !== null && r !== void 0 && r.emitClose) {
        self2.emit("close");
      }
    }
    function emitErrorNT(self2, err) {
      const r = self2._readableState;
      const w = self2._writableState;
      if (w !== null && w !== void 0 && w.errorEmitted || r !== null && r !== void 0 && r.errorEmitted) {
        return;
      }
      if (w) {
        w.errorEmitted = true;
      }
      if (r) {
        r.errorEmitted = true;
      }
      self2.emit("error", err);
    }
    function undestroy() {
      const r = this._readableState;
      const w = this._writableState;
      if (r) {
        r.constructed = true;
        r.closed = false;
        r.closeEmitted = false;
        r.destroyed = false;
        r.errored = null;
        r.errorEmitted = false;
        r.reading = false;
        r.ended = r.readable === false;
        r.endEmitted = r.readable === false;
      }
      if (w) {
        w.constructed = true;
        w.destroyed = false;
        w.closed = false;
        w.closeEmitted = false;
        w.errored = null;
        w.errorEmitted = false;
        w.finalCalled = false;
        w.prefinished = false;
        w.ended = w.writable === false;
        w.ending = w.writable === false;
        w.finished = w.writable === false;
      }
    }
    function errorOrDestroy(stream, err, sync) {
      const r = stream._readableState;
      const w = stream._writableState;
      if (w !== null && w !== void 0 && w.destroyed || r !== null && r !== void 0 && r.destroyed) {
        return this;
      }
      if (r !== null && r !== void 0 && r.autoDestroy || w !== null && w !== void 0 && w.autoDestroy)
        stream.destroy(err);
      else if (err) {
        err.stack;
        if (w && !w.errored) {
          w.errored = err;
        }
        if (r && !r.errored) {
          r.errored = err;
        }
        if (sync) {
          process2.nextTick(emitErrorNT, stream, err);
        } else {
          emitErrorNT(stream, err);
        }
      }
    }
    function construct(stream, cb) {
      if (typeof stream._construct !== "function") {
        return;
      }
      const r = stream._readableState;
      const w = stream._writableState;
      if (r) {
        r.constructed = false;
      }
      if (w) {
        w.constructed = false;
      }
      stream.once(kConstruct, cb);
      if (stream.listenerCount(kConstruct) > 1) {
        return;
      }
      process2.nextTick(constructNT, stream);
    }
    function constructNT(stream) {
      let called = false;
      function onConstruct(err) {
        if (called) {
          errorOrDestroy(stream, err !== null && err !== void 0 ? err : new ERR_MULTIPLE_CALLBACK());
          return;
        }
        called = true;
        const r = stream._readableState;
        const w = stream._writableState;
        const s = w || r;
        if (r) {
          r.constructed = true;
        }
        if (w) {
          w.constructed = true;
        }
        if (s.destroyed) {
          stream.emit(kDestroy, err);
        } else if (err) {
          errorOrDestroy(stream, err, true);
        } else {
          process2.nextTick(emitConstructNT, stream);
        }
      }
      try {
        stream._construct((err) => {
          process2.nextTick(onConstruct, err);
        });
      } catch (err) {
        process2.nextTick(onConstruct, err);
      }
    }
    function emitConstructNT(stream) {
      stream.emit(kConstruct);
    }
    function isRequest(stream) {
      return (stream === null || stream === void 0 ? void 0 : stream.setHeader) && typeof stream.abort === "function";
    }
    function emitCloseLegacy(stream) {
      stream.emit("close");
    }
    function emitErrorCloseLegacy(stream, err) {
      stream.emit("error", err);
      process2.nextTick(emitCloseLegacy, stream);
    }
    function destroyer(stream, err) {
      if (!stream || isDestroyed(stream)) {
        return;
      }
      if (!err && !isFinished(stream)) {
        err = new AbortError();
      }
      if (isServerRequest(stream)) {
        stream.socket = null;
        stream.destroy(err);
      } else if (isRequest(stream)) {
        stream.abort();
      } else if (isRequest(stream.req)) {
        stream.req.abort();
      } else if (typeof stream.destroy === "function") {
        stream.destroy(err);
      } else if (typeof stream.close === "function") {
        stream.close();
      } else if (err) {
        process2.nextTick(emitErrorCloseLegacy, stream, err);
      } else {
        process2.nextTick(emitCloseLegacy, stream);
      }
      if (!stream.destroyed) {
        stream[kIsDestroyed] = true;
      }
    }
    module.exports = {
      construct,
      destroyer,
      destroy,
      undestroy,
      errorOrDestroy
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/legacy.js
var require_legacy = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/legacy.js"(exports, module) {
    "use strict";
    var { ArrayIsArray, ObjectSetPrototypeOf } = require_primordials();
    var { EventEmitter: EE } = require_events();
    function Stream(opts) {
      EE.call(this, opts);
    }
    ObjectSetPrototypeOf(Stream.prototype, EE.prototype);
    ObjectSetPrototypeOf(Stream, EE);
    Stream.prototype.pipe = function(dest, options) {
      const source2 = this;
      function ondata(chunk) {
        if (dest.writable && dest.write(chunk) === false && source2.pause) {
          source2.pause();
        }
      }
      source2.on("data", ondata);
      function ondrain() {
        if (source2.readable && source2.resume) {
          source2.resume();
        }
      }
      dest.on("drain", ondrain);
      if (!dest._isStdio && (!options || options.end !== false)) {
        source2.on("end", onend);
        source2.on("close", onclose);
      }
      let didOnEnd = false;
      function onend() {
        if (didOnEnd) return;
        didOnEnd = true;
        dest.end();
      }
      function onclose() {
        if (didOnEnd) return;
        didOnEnd = true;
        if (typeof dest.destroy === "function") dest.destroy();
      }
      function onerror(er) {
        cleanup();
        if (EE.listenerCount(this, "error") === 0) {
          this.emit("error", er);
        }
      }
      prependListener(source2, "error", onerror);
      prependListener(dest, "error", onerror);
      function cleanup() {
        source2.removeListener("data", ondata);
        dest.removeListener("drain", ondrain);
        source2.removeListener("end", onend);
        source2.removeListener("close", onclose);
        source2.removeListener("error", onerror);
        dest.removeListener("error", onerror);
        source2.removeListener("end", cleanup);
        source2.removeListener("close", cleanup);
        dest.removeListener("close", cleanup);
      }
      source2.on("end", cleanup);
      source2.on("close", cleanup);
      dest.on("close", cleanup);
      dest.emit("pipe", source2);
      return dest;
    };
    function prependListener(emitter, event, fn) {
      if (typeof emitter.prependListener === "function") return emitter.prependListener(event, fn);
      if (!emitter._events || !emitter._events[event]) emitter.on(event, fn);
      else if (ArrayIsArray(emitter._events[event])) emitter._events[event].unshift(fn);
      else emitter._events[event] = [fn, emitter._events[event]];
    }
    module.exports = {
      Stream,
      prependListener
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/add-abort-signal.js
var require_add_abort_signal = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/add-abort-signal.js"(exports, module) {
    "use strict";
    var { SymbolDispose } = require_primordials();
    var { AbortError, codes } = require_errors();
    var { isNodeStream, isWebStream, kControllerErrorFunction } = require_utils();
    var eos = require_end_of_stream();
    var { ERR_INVALID_ARG_TYPE } = codes;
    var addAbortListener;
    var validateAbortSignal = (signal, name) => {
      if (typeof signal !== "object" || !("aborted" in signal)) {
        throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
      }
    };
    module.exports.addAbortSignal = function addAbortSignal(signal, stream) {
      validateAbortSignal(signal, "signal");
      if (!isNodeStream(stream) && !isWebStream(stream)) {
        throw new ERR_INVALID_ARG_TYPE("stream", ["ReadableStream", "WritableStream", "Stream"], stream);
      }
      return module.exports.addAbortSignalNoValidate(signal, stream);
    };
    module.exports.addAbortSignalNoValidate = function(signal, stream) {
      if (typeof signal !== "object" || !("aborted" in signal)) {
        return stream;
      }
      const onAbort = isNodeStream(stream) ? () => {
        stream.destroy(
          new AbortError(void 0, {
            cause: signal.reason
          })
        );
      } : () => {
        stream[kControllerErrorFunction](
          new AbortError(void 0, {
            cause: signal.reason
          })
        );
      };
      if (signal.aborted) {
        onAbort();
      } else {
        addAbortListener = addAbortListener || require_util().addAbortListener;
        const disposable = addAbortListener(signal, onAbort);
        eos(stream, disposable[SymbolDispose]);
      }
      return stream;
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/buffer_list.js
var require_buffer_list = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/buffer_list.js"(exports, module) {
    "use strict";
    var { StringPrototypeSlice, SymbolIterator, TypedArrayPrototypeSet, Uint8Array: Uint8Array2 } = require_primordials();
    var { Buffer: Buffer3 } = require_buffer();
    var { inspect: inspect2 } = require_util();
    module.exports = class BufferList {
      constructor() {
        this.head = null;
        this.tail = null;
        this.length = 0;
      }
      push(v) {
        const entry = {
          data: v,
          next: null
        };
        if (this.length > 0) this.tail.next = entry;
        else this.head = entry;
        this.tail = entry;
        ++this.length;
      }
      unshift(v) {
        const entry = {
          data: v,
          next: this.head
        };
        if (this.length === 0) this.tail = entry;
        this.head = entry;
        ++this.length;
      }
      shift() {
        if (this.length === 0) return;
        const ret = this.head.data;
        if (this.length === 1) this.head = this.tail = null;
        else this.head = this.head.next;
        --this.length;
        return ret;
      }
      clear() {
        this.head = this.tail = null;
        this.length = 0;
      }
      join(s) {
        if (this.length === 0) return "";
        let p = this.head;
        let ret = "" + p.data;
        while ((p = p.next) !== null) ret += s + p.data;
        return ret;
      }
      concat(n2) {
        if (this.length === 0) return Buffer3.alloc(0);
        const ret = Buffer3.allocUnsafe(n2 >>> 0);
        let p = this.head;
        let i2 = 0;
        while (p) {
          TypedArrayPrototypeSet(ret, p.data, i2);
          i2 += p.data.length;
          p = p.next;
        }
        return ret;
      }
      // Consumes a specified amount of bytes or characters from the buffered data.
      consume(n2, hasStrings) {
        const data = this.head.data;
        if (n2 < data.length) {
          const slice = data.slice(0, n2);
          this.head.data = data.slice(n2);
          return slice;
        }
        if (n2 === data.length) {
          return this.shift();
        }
        return hasStrings ? this._getString(n2) : this._getBuffer(n2);
      }
      first() {
        return this.head.data;
      }
      *[SymbolIterator]() {
        for (let p = this.head; p; p = p.next) {
          yield p.data;
        }
      }
      // Consumes a specified amount of characters from the buffered data.
      _getString(n2) {
        let ret = "";
        let p = this.head;
        let c3 = 0;
        do {
          const str = p.data;
          if (n2 > str.length) {
            ret += str;
            n2 -= str.length;
          } else {
            if (n2 === str.length) {
              ret += str;
              ++c3;
              if (p.next) this.head = p.next;
              else this.head = this.tail = null;
            } else {
              ret += StringPrototypeSlice(str, 0, n2);
              this.head = p;
              p.data = StringPrototypeSlice(str, n2);
            }
            break;
          }
          ++c3;
        } while ((p = p.next) !== null);
        this.length -= c3;
        return ret;
      }
      // Consumes a specified amount of bytes from the buffered data.
      _getBuffer(n2) {
        const ret = Buffer3.allocUnsafe(n2);
        const retLen = n2;
        let p = this.head;
        let c3 = 0;
        do {
          const buf = p.data;
          if (n2 > buf.length) {
            TypedArrayPrototypeSet(ret, buf, retLen - n2);
            n2 -= buf.length;
          } else {
            if (n2 === buf.length) {
              TypedArrayPrototypeSet(ret, buf, retLen - n2);
              ++c3;
              if (p.next) this.head = p.next;
              else this.head = this.tail = null;
            } else {
              TypedArrayPrototypeSet(ret, new Uint8Array2(buf.buffer, buf.byteOffset, n2), retLen - n2);
              this.head = p;
              p.data = buf.slice(n2);
            }
            break;
          }
          ++c3;
        } while ((p = p.next) !== null);
        this.length -= c3;
        return ret;
      }
      // Make sure the linked list only shows the minimal necessary information.
      [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")](_, options) {
        return inspect2(this, {
          ...options,
          // Only inspect one level.
          depth: 0,
          // It should not recurse.
          customInspect: false
        });
      }
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/state.js
var require_state = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/state.js"(exports, module) {
    "use strict";
    var { MathFloor, NumberIsInteger } = require_primordials();
    var { validateInteger } = require_validators();
    var { ERR_INVALID_ARG_VALUE } = require_errors().codes;
    var defaultHighWaterMarkBytes = 16 * 1024;
    var defaultHighWaterMarkObjectMode = 16;
    function highWaterMarkFrom(options, isDuplex, duplexKey) {
      return options.highWaterMark != null ? options.highWaterMark : isDuplex ? options[duplexKey] : null;
    }
    function getDefaultHighWaterMark(objectMode) {
      return objectMode ? defaultHighWaterMarkObjectMode : defaultHighWaterMarkBytes;
    }
    function setDefaultHighWaterMark(objectMode, value) {
      validateInteger(value, "value", 0);
      if (objectMode) {
        defaultHighWaterMarkObjectMode = value;
      } else {
        defaultHighWaterMarkBytes = value;
      }
    }
    function getHighWaterMark(state, options, duplexKey, isDuplex) {
      const hwm = highWaterMarkFrom(options, isDuplex, duplexKey);
      if (hwm != null) {
        if (!NumberIsInteger(hwm) || hwm < 0) {
          const name = isDuplex ? `options.${duplexKey}` : "options.highWaterMark";
          throw new ERR_INVALID_ARG_VALUE(name, hwm);
        }
        return MathFloor(hwm);
      }
      return getDefaultHighWaterMark(state.objectMode);
    }
    module.exports = {
      getHighWaterMark,
      getDefaultHighWaterMark,
      setDefaultHighWaterMark
    };
  }
});

// node_modules/safe-buffer/index.js
var require_safe_buffer = __commonJS({
  "node_modules/safe-buffer/index.js"(exports, module) {
    var buffer = require_buffer();
    var Buffer3 = buffer.Buffer;
    function copyProps(src, dst) {
      for (var key in src) {
        dst[key] = src[key];
      }
    }
    if (Buffer3.from && Buffer3.alloc && Buffer3.allocUnsafe && Buffer3.allocUnsafeSlow) {
      module.exports = buffer;
    } else {
      copyProps(buffer, exports);
      exports.Buffer = SafeBuffer;
    }
    function SafeBuffer(arg, encodingOrOffset, length) {
      return Buffer3(arg, encodingOrOffset, length);
    }
    SafeBuffer.prototype = Object.create(Buffer3.prototype);
    copyProps(Buffer3, SafeBuffer);
    SafeBuffer.from = function(arg, encodingOrOffset, length) {
      if (typeof arg === "number") {
        throw new TypeError("Argument must not be a number");
      }
      return Buffer3(arg, encodingOrOffset, length);
    };
    SafeBuffer.alloc = function(size, fill, encoding) {
      if (typeof size !== "number") {
        throw new TypeError("Argument must be a number");
      }
      var buf = Buffer3(size);
      if (fill !== void 0) {
        if (typeof encoding === "string") {
          buf.fill(fill, encoding);
        } else {
          buf.fill(fill);
        }
      } else {
        buf.fill(0);
      }
      return buf;
    };
    SafeBuffer.allocUnsafe = function(size) {
      if (typeof size !== "number") {
        throw new TypeError("Argument must be a number");
      }
      return Buffer3(size);
    };
    SafeBuffer.allocUnsafeSlow = function(size) {
      if (typeof size !== "number") {
        throw new TypeError("Argument must be a number");
      }
      return buffer.SlowBuffer(size);
    };
  }
});

// node_modules/string_decoder/lib/string_decoder.js
var require_string_decoder = __commonJS({
  "node_modules/string_decoder/lib/string_decoder.js"(exports) {
    "use strict";
    var Buffer3 = require_safe_buffer().Buffer;
    var isEncoding = Buffer3.isEncoding || function(encoding) {
      encoding = "" + encoding;
      switch (encoding && encoding.toLowerCase()) {
        case "hex":
        case "utf8":
        case "utf-8":
        case "ascii":
        case "binary":
        case "base64":
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
        case "raw":
          return true;
        default:
          return false;
      }
    };
    function _normalizeEncoding(enc) {
      if (!enc) return "utf8";
      var retried;
      while (true) {
        switch (enc) {
          case "utf8":
          case "utf-8":
            return "utf8";
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return "utf16le";
          case "latin1":
          case "binary":
            return "latin1";
          case "base64":
          case "ascii":
          case "hex":
            return enc;
          default:
            if (retried) return;
            enc = ("" + enc).toLowerCase();
            retried = true;
        }
      }
    }
    function normalizeEncoding(enc) {
      var nenc = _normalizeEncoding(enc);
      if (typeof nenc !== "string" && (Buffer3.isEncoding === isEncoding || !isEncoding(enc))) throw new Error("Unknown encoding: " + enc);
      return nenc || enc;
    }
    exports.StringDecoder = StringDecoder;
    function StringDecoder(encoding) {
      this.encoding = normalizeEncoding(encoding);
      var nb;
      switch (this.encoding) {
        case "utf16le":
          this.text = utf16Text;
          this.end = utf16End;
          nb = 4;
          break;
        case "utf8":
          this.fillLast = utf8FillLast;
          nb = 4;
          break;
        case "base64":
          this.text = base64Text;
          this.end = base64End;
          nb = 3;
          break;
        default:
          this.write = simpleWrite;
          this.end = simpleEnd;
          return;
      }
      this.lastNeed = 0;
      this.lastTotal = 0;
      this.lastChar = Buffer3.allocUnsafe(nb);
    }
    StringDecoder.prototype.write = function(buf) {
      if (buf.length === 0) return "";
      var r;
      var i2;
      if (this.lastNeed) {
        r = this.fillLast(buf);
        if (r === void 0) return "";
        i2 = this.lastNeed;
        this.lastNeed = 0;
      } else {
        i2 = 0;
      }
      if (i2 < buf.length) return r ? r + this.text(buf, i2) : this.text(buf, i2);
      return r || "";
    };
    StringDecoder.prototype.end = utf8End;
    StringDecoder.prototype.text = utf8Text;
    StringDecoder.prototype.fillLast = function(buf) {
      if (this.lastNeed <= buf.length) {
        buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, this.lastNeed);
        return this.lastChar.toString(this.encoding, 0, this.lastTotal);
      }
      buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, buf.length);
      this.lastNeed -= buf.length;
    };
    function utf8CheckByte(byte) {
      if (byte <= 127) return 0;
      else if (byte >> 5 === 6) return 2;
      else if (byte >> 4 === 14) return 3;
      else if (byte >> 3 === 30) return 4;
      return byte >> 6 === 2 ? -1 : -2;
    }
    function utf8CheckIncomplete(self2, buf, i2) {
      var j = buf.length - 1;
      if (j < i2) return 0;
      var nb = utf8CheckByte(buf[j]);
      if (nb >= 0) {
        if (nb > 0) self2.lastNeed = nb - 1;
        return nb;
      }
      if (--j < i2 || nb === -2) return 0;
      nb = utf8CheckByte(buf[j]);
      if (nb >= 0) {
        if (nb > 0) self2.lastNeed = nb - 2;
        return nb;
      }
      if (--j < i2 || nb === -2) return 0;
      nb = utf8CheckByte(buf[j]);
      if (nb >= 0) {
        if (nb > 0) {
          if (nb === 2) nb = 0;
          else self2.lastNeed = nb - 3;
        }
        return nb;
      }
      return 0;
    }
    function utf8CheckExtraBytes(self2, buf, p) {
      if ((buf[0] & 192) !== 128) {
        self2.lastNeed = 0;
        return "\uFFFD";
      }
      if (self2.lastNeed > 1 && buf.length > 1) {
        if ((buf[1] & 192) !== 128) {
          self2.lastNeed = 1;
          return "\uFFFD";
        }
        if (self2.lastNeed > 2 && buf.length > 2) {
          if ((buf[2] & 192) !== 128) {
            self2.lastNeed = 2;
            return "\uFFFD";
          }
        }
      }
    }
    function utf8FillLast(buf) {
      var p = this.lastTotal - this.lastNeed;
      var r = utf8CheckExtraBytes(this, buf, p);
      if (r !== void 0) return r;
      if (this.lastNeed <= buf.length) {
        buf.copy(this.lastChar, p, 0, this.lastNeed);
        return this.lastChar.toString(this.encoding, 0, this.lastTotal);
      }
      buf.copy(this.lastChar, p, 0, buf.length);
      this.lastNeed -= buf.length;
    }
    function utf8Text(buf, i2) {
      var total = utf8CheckIncomplete(this, buf, i2);
      if (!this.lastNeed) return buf.toString("utf8", i2);
      this.lastTotal = total;
      var end = buf.length - (total - this.lastNeed);
      buf.copy(this.lastChar, 0, end);
      return buf.toString("utf8", i2, end);
    }
    function utf8End(buf) {
      var r = buf && buf.length ? this.write(buf) : "";
      if (this.lastNeed) return r + "\uFFFD";
      return r;
    }
    function utf16Text(buf, i2) {
      if ((buf.length - i2) % 2 === 0) {
        var r = buf.toString("utf16le", i2);
        if (r) {
          var c3 = r.charCodeAt(r.length - 1);
          if (c3 >= 55296 && c3 <= 56319) {
            this.lastNeed = 2;
            this.lastTotal = 4;
            this.lastChar[0] = buf[buf.length - 2];
            this.lastChar[1] = buf[buf.length - 1];
            return r.slice(0, -1);
          }
        }
        return r;
      }
      this.lastNeed = 1;
      this.lastTotal = 2;
      this.lastChar[0] = buf[buf.length - 1];
      return buf.toString("utf16le", i2, buf.length - 1);
    }
    function utf16End(buf) {
      var r = buf && buf.length ? this.write(buf) : "";
      if (this.lastNeed) {
        var end = this.lastTotal - this.lastNeed;
        return r + this.lastChar.toString("utf16le", 0, end);
      }
      return r;
    }
    function base64Text(buf, i2) {
      var n2 = (buf.length - i2) % 3;
      if (n2 === 0) return buf.toString("base64", i2);
      this.lastNeed = 3 - n2;
      this.lastTotal = 3;
      if (n2 === 1) {
        this.lastChar[0] = buf[buf.length - 1];
      } else {
        this.lastChar[0] = buf[buf.length - 2];
        this.lastChar[1] = buf[buf.length - 1];
      }
      return buf.toString("base64", i2, buf.length - n2);
    }
    function base64End(buf) {
      var r = buf && buf.length ? this.write(buf) : "";
      if (this.lastNeed) return r + this.lastChar.toString("base64", 0, 3 - this.lastNeed);
      return r;
    }
    function simpleWrite(buf) {
      return buf.toString(this.encoding);
    }
    function simpleEnd(buf) {
      return buf && buf.length ? this.write(buf) : "";
    }
  }
});

// node_modules/readable-stream/lib/internal/streams/from.js
var require_from = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/from.js"(exports, module) {
    "use strict";
    var process2 = require_browser2();
    var { PromisePrototypeThen, SymbolAsyncIterator, SymbolIterator } = require_primordials();
    var { Buffer: Buffer3 } = require_buffer();
    var { ERR_INVALID_ARG_TYPE, ERR_STREAM_NULL_VALUES } = require_errors().codes;
    function from(Readable, iterable, opts) {
      let iterator;
      if (typeof iterable === "string" || iterable instanceof Buffer3) {
        return new Readable({
          objectMode: true,
          ...opts,
          read() {
            this.push(iterable);
            this.push(null);
          }
        });
      }
      let isAsync;
      if (iterable && iterable[SymbolAsyncIterator]) {
        isAsync = true;
        iterator = iterable[SymbolAsyncIterator]();
      } else if (iterable && iterable[SymbolIterator]) {
        isAsync = false;
        iterator = iterable[SymbolIterator]();
      } else {
        throw new ERR_INVALID_ARG_TYPE("iterable", ["Iterable"], iterable);
      }
      const readable = new Readable({
        objectMode: true,
        highWaterMark: 1,
        // TODO(ronag): What options should be allowed?
        ...opts
      });
      let reading = false;
      readable._read = function() {
        if (!reading) {
          reading = true;
          next();
        }
      };
      readable._destroy = function(error2, cb) {
        PromisePrototypeThen(
          close(error2),
          () => process2.nextTick(cb, error2),
          // nextTick is here in case cb throws
          (e) => process2.nextTick(cb, e || error2)
        );
      };
      async function close(error2) {
        const hadError = error2 !== void 0 && error2 !== null;
        const hasThrow = typeof iterator.throw === "function";
        if (hadError && hasThrow) {
          const { value, done } = await iterator.throw(error2);
          await value;
          if (done) {
            return;
          }
        }
        if (typeof iterator.return === "function") {
          const { value } = await iterator.return();
          await value;
        }
      }
      async function next() {
        for (; ; ) {
          try {
            const { value, done } = isAsync ? await iterator.next() : iterator.next();
            if (done) {
              readable.push(null);
            } else {
              const res = value && typeof value.then === "function" ? await value : value;
              if (res === null) {
                reading = false;
                throw new ERR_STREAM_NULL_VALUES();
              } else if (readable.push(res)) {
                continue;
              } else {
                reading = false;
              }
            }
          } catch (err) {
            readable.destroy(err);
          }
          break;
        }
      }
      return readable;
    }
    module.exports = from;
  }
});

// node_modules/readable-stream/lib/internal/streams/readable.js
var require_readable = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/readable.js"(exports, module) {
    "use strict";
    var process2 = require_browser2();
    var {
      ArrayPrototypeIndexOf,
      NumberIsInteger,
      NumberIsNaN,
      NumberParseInt,
      ObjectDefineProperties,
      ObjectKeys,
      ObjectSetPrototypeOf,
      Promise: Promise2,
      SafeSet,
      SymbolAsyncDispose,
      SymbolAsyncIterator,
      Symbol: Symbol2
    } = require_primordials();
    module.exports = Readable;
    Readable.ReadableState = ReadableState;
    var { EventEmitter: EE } = require_events();
    var { Stream, prependListener } = require_legacy();
    var { Buffer: Buffer3 } = require_buffer();
    var { addAbortSignal } = require_add_abort_signal();
    var eos = require_end_of_stream();
    var debug2 = require_util().debuglog("stream", (fn) => {
      debug2 = fn;
    });
    var BufferList = require_buffer_list();
    var destroyImpl = require_destroy();
    var { getHighWaterMark, getDefaultHighWaterMark } = require_state();
    var {
      aggregateTwoErrors,
      codes: {
        ERR_INVALID_ARG_TYPE,
        ERR_METHOD_NOT_IMPLEMENTED,
        ERR_OUT_OF_RANGE,
        ERR_STREAM_PUSH_AFTER_EOF,
        ERR_STREAM_UNSHIFT_AFTER_END_EVENT
      },
      AbortError
    } = require_errors();
    var { validateObject } = require_validators();
    var kPaused = Symbol2("kPaused");
    var { StringDecoder } = require_string_decoder();
    var from = require_from();
    ObjectSetPrototypeOf(Readable.prototype, Stream.prototype);
    ObjectSetPrototypeOf(Readable, Stream);
    var nop = () => {
    };
    var { errorOrDestroy } = destroyImpl;
    var kObjectMode = 1 << 0;
    var kEnded = 1 << 1;
    var kEndEmitted = 1 << 2;
    var kReading = 1 << 3;
    var kConstructed = 1 << 4;
    var kSync = 1 << 5;
    var kNeedReadable = 1 << 6;
    var kEmittedReadable = 1 << 7;
    var kReadableListening = 1 << 8;
    var kResumeScheduled = 1 << 9;
    var kErrorEmitted = 1 << 10;
    var kEmitClose = 1 << 11;
    var kAutoDestroy = 1 << 12;
    var kDestroyed = 1 << 13;
    var kClosed = 1 << 14;
    var kCloseEmitted = 1 << 15;
    var kMultiAwaitDrain = 1 << 16;
    var kReadingMore = 1 << 17;
    var kDataEmitted = 1 << 18;
    function makeBitMapDescriptor(bit) {
      return {
        enumerable: false,
        get() {
          return (this.state & bit) !== 0;
        },
        set(value) {
          if (value) this.state |= bit;
          else this.state &= ~bit;
        }
      };
    }
    ObjectDefineProperties(ReadableState.prototype, {
      objectMode: makeBitMapDescriptor(kObjectMode),
      ended: makeBitMapDescriptor(kEnded),
      endEmitted: makeBitMapDescriptor(kEndEmitted),
      reading: makeBitMapDescriptor(kReading),
      // Stream is still being constructed and cannot be
      // destroyed until construction finished or failed.
      // Async construction is opt in, therefore we start as
      // constructed.
      constructed: makeBitMapDescriptor(kConstructed),
      // A flag to be able to tell if the event 'readable'/'data' is emitted
      // immediately, or on a later tick.  We set this to true at first, because
      // any actions that shouldn't happen until "later" should generally also
      // not happen before the first read call.
      sync: makeBitMapDescriptor(kSync),
      // Whenever we return null, then we set a flag to say
      // that we're awaiting a 'readable' event emission.
      needReadable: makeBitMapDescriptor(kNeedReadable),
      emittedReadable: makeBitMapDescriptor(kEmittedReadable),
      readableListening: makeBitMapDescriptor(kReadableListening),
      resumeScheduled: makeBitMapDescriptor(kResumeScheduled),
      // True if the error was already emitted and should not be thrown again.
      errorEmitted: makeBitMapDescriptor(kErrorEmitted),
      emitClose: makeBitMapDescriptor(kEmitClose),
      autoDestroy: makeBitMapDescriptor(kAutoDestroy),
      // Has it been destroyed.
      destroyed: makeBitMapDescriptor(kDestroyed),
      // Indicates whether the stream has finished destroying.
      closed: makeBitMapDescriptor(kClosed),
      // True if close has been emitted or would have been emitted
      // depending on emitClose.
      closeEmitted: makeBitMapDescriptor(kCloseEmitted),
      multiAwaitDrain: makeBitMapDescriptor(kMultiAwaitDrain),
      // If true, a maybeReadMore has been scheduled.
      readingMore: makeBitMapDescriptor(kReadingMore),
      dataEmitted: makeBitMapDescriptor(kDataEmitted)
    });
    function ReadableState(options, stream, isDuplex) {
      if (typeof isDuplex !== "boolean") isDuplex = stream instanceof require_duplex();
      this.state = kEmitClose | kAutoDestroy | kConstructed | kSync;
      if (options && options.objectMode) this.state |= kObjectMode;
      if (isDuplex && options && options.readableObjectMode) this.state |= kObjectMode;
      this.highWaterMark = options ? getHighWaterMark(this, options, "readableHighWaterMark", isDuplex) : getDefaultHighWaterMark(false);
      this.buffer = new BufferList();
      this.length = 0;
      this.pipes = [];
      this.flowing = null;
      this[kPaused] = null;
      if (options && options.emitClose === false) this.state &= ~kEmitClose;
      if (options && options.autoDestroy === false) this.state &= ~kAutoDestroy;
      this.errored = null;
      this.defaultEncoding = options && options.defaultEncoding || "utf8";
      this.awaitDrainWriters = null;
      this.decoder = null;
      this.encoding = null;
      if (options && options.encoding) {
        this.decoder = new StringDecoder(options.encoding);
        this.encoding = options.encoding;
      }
    }
    function Readable(options) {
      if (!(this instanceof Readable)) return new Readable(options);
      const isDuplex = this instanceof require_duplex();
      this._readableState = new ReadableState(options, this, isDuplex);
      if (options) {
        if (typeof options.read === "function") this._read = options.read;
        if (typeof options.destroy === "function") this._destroy = options.destroy;
        if (typeof options.construct === "function") this._construct = options.construct;
        if (options.signal && !isDuplex) addAbortSignal(options.signal, this);
      }
      Stream.call(this, options);
      destroyImpl.construct(this, () => {
        if (this._readableState.needReadable) {
          maybeReadMore(this, this._readableState);
        }
      });
    }
    Readable.prototype.destroy = destroyImpl.destroy;
    Readable.prototype._undestroy = destroyImpl.undestroy;
    Readable.prototype._destroy = function(err, cb) {
      cb(err);
    };
    Readable.prototype[EE.captureRejectionSymbol] = function(err) {
      this.destroy(err);
    };
    Readable.prototype[SymbolAsyncDispose] = function() {
      let error2;
      if (!this.destroyed) {
        error2 = this.readableEnded ? null : new AbortError();
        this.destroy(error2);
      }
      return new Promise2((resolve, reject) => eos(this, (err) => err && err !== error2 ? reject(err) : resolve(null)));
    };
    Readable.prototype.push = function(chunk, encoding) {
      return readableAddChunk(this, chunk, encoding, false);
    };
    Readable.prototype.unshift = function(chunk, encoding) {
      return readableAddChunk(this, chunk, encoding, true);
    };
    function readableAddChunk(stream, chunk, encoding, addToFront) {
      debug2("readableAddChunk", chunk);
      const state = stream._readableState;
      let err;
      if ((state.state & kObjectMode) === 0) {
        if (typeof chunk === "string") {
          encoding = encoding || state.defaultEncoding;
          if (state.encoding !== encoding) {
            if (addToFront && state.encoding) {
              chunk = Buffer3.from(chunk, encoding).toString(state.encoding);
            } else {
              chunk = Buffer3.from(chunk, encoding);
              encoding = "";
            }
          }
        } else if (chunk instanceof Buffer3) {
          encoding = "";
        } else if (Stream._isUint8Array(chunk)) {
          chunk = Stream._uint8ArrayToBuffer(chunk);
          encoding = "";
        } else if (chunk != null) {
          err = new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "Uint8Array"], chunk);
        }
      }
      if (err) {
        errorOrDestroy(stream, err);
      } else if (chunk === null) {
        state.state &= ~kReading;
        onEofChunk(stream, state);
      } else if ((state.state & kObjectMode) !== 0 || chunk && chunk.length > 0) {
        if (addToFront) {
          if ((state.state & kEndEmitted) !== 0) errorOrDestroy(stream, new ERR_STREAM_UNSHIFT_AFTER_END_EVENT());
          else if (state.destroyed || state.errored) return false;
          else addChunk(stream, state, chunk, true);
        } else if (state.ended) {
          errorOrDestroy(stream, new ERR_STREAM_PUSH_AFTER_EOF());
        } else if (state.destroyed || state.errored) {
          return false;
        } else {
          state.state &= ~kReading;
          if (state.decoder && !encoding) {
            chunk = state.decoder.write(chunk);
            if (state.objectMode || chunk.length !== 0) addChunk(stream, state, chunk, false);
            else maybeReadMore(stream, state);
          } else {
            addChunk(stream, state, chunk, false);
          }
        }
      } else if (!addToFront) {
        state.state &= ~kReading;
        maybeReadMore(stream, state);
      }
      return !state.ended && (state.length < state.highWaterMark || state.length === 0);
    }
    function addChunk(stream, state, chunk, addToFront) {
      if (state.flowing && state.length === 0 && !state.sync && stream.listenerCount("data") > 0) {
        if ((state.state & kMultiAwaitDrain) !== 0) {
          state.awaitDrainWriters.clear();
        } else {
          state.awaitDrainWriters = null;
        }
        state.dataEmitted = true;
        stream.emit("data", chunk);
      } else {
        state.length += state.objectMode ? 1 : chunk.length;
        if (addToFront) state.buffer.unshift(chunk);
        else state.buffer.push(chunk);
        if ((state.state & kNeedReadable) !== 0) emitReadable(stream);
      }
      maybeReadMore(stream, state);
    }
    Readable.prototype.isPaused = function() {
      const state = this._readableState;
      return state[kPaused] === true || state.flowing === false;
    };
    Readable.prototype.setEncoding = function(enc) {
      const decoder = new StringDecoder(enc);
      this._readableState.decoder = decoder;
      this._readableState.encoding = this._readableState.decoder.encoding;
      const buffer = this._readableState.buffer;
      let content = "";
      for (const data of buffer) {
        content += decoder.write(data);
      }
      buffer.clear();
      if (content !== "") buffer.push(content);
      this._readableState.length = content.length;
      return this;
    };
    var MAX_HWM = 1073741824;
    function computeNewHighWaterMark(n2) {
      if (n2 > MAX_HWM) {
        throw new ERR_OUT_OF_RANGE("size", "<= 1GiB", n2);
      } else {
        n2--;
        n2 |= n2 >>> 1;
        n2 |= n2 >>> 2;
        n2 |= n2 >>> 4;
        n2 |= n2 >>> 8;
        n2 |= n2 >>> 16;
        n2++;
      }
      return n2;
    }
    function howMuchToRead(n2, state) {
      if (n2 <= 0 || state.length === 0 && state.ended) return 0;
      if ((state.state & kObjectMode) !== 0) return 1;
      if (NumberIsNaN(n2)) {
        if (state.flowing && state.length) return state.buffer.first().length;
        return state.length;
      }
      if (n2 <= state.length) return n2;
      return state.ended ? state.length : 0;
    }
    Readable.prototype.read = function(n2) {
      debug2("read", n2);
      if (n2 === void 0) {
        n2 = NaN;
      } else if (!NumberIsInteger(n2)) {
        n2 = NumberParseInt(n2, 10);
      }
      const state = this._readableState;
      const nOrig = n2;
      if (n2 > state.highWaterMark) state.highWaterMark = computeNewHighWaterMark(n2);
      if (n2 !== 0) state.state &= ~kEmittedReadable;
      if (n2 === 0 && state.needReadable && ((state.highWaterMark !== 0 ? state.length >= state.highWaterMark : state.length > 0) || state.ended)) {
        debug2("read: emitReadable", state.length, state.ended);
        if (state.length === 0 && state.ended) endReadable(this);
        else emitReadable(this);
        return null;
      }
      n2 = howMuchToRead(n2, state);
      if (n2 === 0 && state.ended) {
        if (state.length === 0) endReadable(this);
        return null;
      }
      let doRead = (state.state & kNeedReadable) !== 0;
      debug2("need readable", doRead);
      if (state.length === 0 || state.length - n2 < state.highWaterMark) {
        doRead = true;
        debug2("length less than watermark", doRead);
      }
      if (state.ended || state.reading || state.destroyed || state.errored || !state.constructed) {
        doRead = false;
        debug2("reading, ended or constructing", doRead);
      } else if (doRead) {
        debug2("do read");
        state.state |= kReading | kSync;
        if (state.length === 0) state.state |= kNeedReadable;
        try {
          this._read(state.highWaterMark);
        } catch (err) {
          errorOrDestroy(this, err);
        }
        state.state &= ~kSync;
        if (!state.reading) n2 = howMuchToRead(nOrig, state);
      }
      let ret;
      if (n2 > 0) ret = fromList(n2, state);
      else ret = null;
      if (ret === null) {
        state.needReadable = state.length <= state.highWaterMark;
        n2 = 0;
      } else {
        state.length -= n2;
        if (state.multiAwaitDrain) {
          state.awaitDrainWriters.clear();
        } else {
          state.awaitDrainWriters = null;
        }
      }
      if (state.length === 0) {
        if (!state.ended) state.needReadable = true;
        if (nOrig !== n2 && state.ended) endReadable(this);
      }
      if (ret !== null && !state.errorEmitted && !state.closeEmitted) {
        state.dataEmitted = true;
        this.emit("data", ret);
      }
      return ret;
    };
    function onEofChunk(stream, state) {
      debug2("onEofChunk");
      if (state.ended) return;
      if (state.decoder) {
        const chunk = state.decoder.end();
        if (chunk && chunk.length) {
          state.buffer.push(chunk);
          state.length += state.objectMode ? 1 : chunk.length;
        }
      }
      state.ended = true;
      if (state.sync) {
        emitReadable(stream);
      } else {
        state.needReadable = false;
        state.emittedReadable = true;
        emitReadable_(stream);
      }
    }
    function emitReadable(stream) {
      const state = stream._readableState;
      debug2("emitReadable", state.needReadable, state.emittedReadable);
      state.needReadable = false;
      if (!state.emittedReadable) {
        debug2("emitReadable", state.flowing);
        state.emittedReadable = true;
        process2.nextTick(emitReadable_, stream);
      }
    }
    function emitReadable_(stream) {
      const state = stream._readableState;
      debug2("emitReadable_", state.destroyed, state.length, state.ended);
      if (!state.destroyed && !state.errored && (state.length || state.ended)) {
        stream.emit("readable");
        state.emittedReadable = false;
      }
      state.needReadable = !state.flowing && !state.ended && state.length <= state.highWaterMark;
      flow(stream);
    }
    function maybeReadMore(stream, state) {
      if (!state.readingMore && state.constructed) {
        state.readingMore = true;
        process2.nextTick(maybeReadMore_, stream, state);
      }
    }
    function maybeReadMore_(stream, state) {
      while (!state.reading && !state.ended && (state.length < state.highWaterMark || state.flowing && state.length === 0)) {
        const len = state.length;
        debug2("maybeReadMore read 0");
        stream.read(0);
        if (len === state.length)
          break;
      }
      state.readingMore = false;
    }
    Readable.prototype._read = function(n2) {
      throw new ERR_METHOD_NOT_IMPLEMENTED("_read()");
    };
    Readable.prototype.pipe = function(dest, pipeOpts) {
      const src = this;
      const state = this._readableState;
      if (state.pipes.length === 1) {
        if (!state.multiAwaitDrain) {
          state.multiAwaitDrain = true;
          state.awaitDrainWriters = new SafeSet(state.awaitDrainWriters ? [state.awaitDrainWriters] : []);
        }
      }
      state.pipes.push(dest);
      debug2("pipe count=%d opts=%j", state.pipes.length, pipeOpts);
      const doEnd = (!pipeOpts || pipeOpts.end !== false) && dest !== process2.stdout && dest !== process2.stderr;
      const endFn = doEnd ? onend : unpipe;
      if (state.endEmitted) process2.nextTick(endFn);
      else src.once("end", endFn);
      dest.on("unpipe", onunpipe);
      function onunpipe(readable, unpipeInfo) {
        debug2("onunpipe");
        if (readable === src) {
          if (unpipeInfo && unpipeInfo.hasUnpiped === false) {
            unpipeInfo.hasUnpiped = true;
            cleanup();
          }
        }
      }
      function onend() {
        debug2("onend");
        dest.end();
      }
      let ondrain;
      let cleanedUp = false;
      function cleanup() {
        debug2("cleanup");
        dest.removeListener("close", onclose);
        dest.removeListener("finish", onfinish);
        if (ondrain) {
          dest.removeListener("drain", ondrain);
        }
        dest.removeListener("error", onerror);
        dest.removeListener("unpipe", onunpipe);
        src.removeListener("end", onend);
        src.removeListener("end", unpipe);
        src.removeListener("data", ondata);
        cleanedUp = true;
        if (ondrain && state.awaitDrainWriters && (!dest._writableState || dest._writableState.needDrain)) ondrain();
      }
      function pause() {
        if (!cleanedUp) {
          if (state.pipes.length === 1 && state.pipes[0] === dest) {
            debug2("false write response, pause", 0);
            state.awaitDrainWriters = dest;
            state.multiAwaitDrain = false;
          } else if (state.pipes.length > 1 && state.pipes.includes(dest)) {
            debug2("false write response, pause", state.awaitDrainWriters.size);
            state.awaitDrainWriters.add(dest);
          }
          src.pause();
        }
        if (!ondrain) {
          ondrain = pipeOnDrain(src, dest);
          dest.on("drain", ondrain);
        }
      }
      src.on("data", ondata);
      function ondata(chunk) {
        debug2("ondata");
        const ret = dest.write(chunk);
        debug2("dest.write", ret);
        if (ret === false) {
          pause();
        }
      }
      function onerror(er) {
        debug2("onerror", er);
        unpipe();
        dest.removeListener("error", onerror);
        if (dest.listenerCount("error") === 0) {
          const s = dest._writableState || dest._readableState;
          if (s && !s.errorEmitted) {
            errorOrDestroy(dest, er);
          } else {
            dest.emit("error", er);
          }
        }
      }
      prependListener(dest, "error", onerror);
      function onclose() {
        dest.removeListener("finish", onfinish);
        unpipe();
      }
      dest.once("close", onclose);
      function onfinish() {
        debug2("onfinish");
        dest.removeListener("close", onclose);
        unpipe();
      }
      dest.once("finish", onfinish);
      function unpipe() {
        debug2("unpipe");
        src.unpipe(dest);
      }
      dest.emit("pipe", src);
      if (dest.writableNeedDrain === true) {
        pause();
      } else if (!state.flowing) {
        debug2("pipe resume");
        src.resume();
      }
      return dest;
    };
    function pipeOnDrain(src, dest) {
      return function pipeOnDrainFunctionResult() {
        const state = src._readableState;
        if (state.awaitDrainWriters === dest) {
          debug2("pipeOnDrain", 1);
          state.awaitDrainWriters = null;
        } else if (state.multiAwaitDrain) {
          debug2("pipeOnDrain", state.awaitDrainWriters.size);
          state.awaitDrainWriters.delete(dest);
        }
        if ((!state.awaitDrainWriters || state.awaitDrainWriters.size === 0) && src.listenerCount("data")) {
          src.resume();
        }
      };
    }
    Readable.prototype.unpipe = function(dest) {
      const state = this._readableState;
      const unpipeInfo = {
        hasUnpiped: false
      };
      if (state.pipes.length === 0) return this;
      if (!dest) {
        const dests = state.pipes;
        state.pipes = [];
        this.pause();
        for (let i2 = 0; i2 < dests.length; i2++)
          dests[i2].emit("unpipe", this, {
            hasUnpiped: false
          });
        return this;
      }
      const index = ArrayPrototypeIndexOf(state.pipes, dest);
      if (index === -1) return this;
      state.pipes.splice(index, 1);
      if (state.pipes.length === 0) this.pause();
      dest.emit("unpipe", this, unpipeInfo);
      return this;
    };
    Readable.prototype.on = function(ev, fn) {
      const res = Stream.prototype.on.call(this, ev, fn);
      const state = this._readableState;
      if (ev === "data") {
        state.readableListening = this.listenerCount("readable") > 0;
        if (state.flowing !== false) this.resume();
      } else if (ev === "readable") {
        if (!state.endEmitted && !state.readableListening) {
          state.readableListening = state.needReadable = true;
          state.flowing = false;
          state.emittedReadable = false;
          debug2("on readable", state.length, state.reading);
          if (state.length) {
            emitReadable(this);
          } else if (!state.reading) {
            process2.nextTick(nReadingNextTick, this);
          }
        }
      }
      return res;
    };
    Readable.prototype.addListener = Readable.prototype.on;
    Readable.prototype.removeListener = function(ev, fn) {
      const res = Stream.prototype.removeListener.call(this, ev, fn);
      if (ev === "readable") {
        process2.nextTick(updateReadableListening, this);
      }
      return res;
    };
    Readable.prototype.off = Readable.prototype.removeListener;
    Readable.prototype.removeAllListeners = function(ev) {
      const res = Stream.prototype.removeAllListeners.apply(this, arguments);
      if (ev === "readable" || ev === void 0) {
        process2.nextTick(updateReadableListening, this);
      }
      return res;
    };
    function updateReadableListening(self2) {
      const state = self2._readableState;
      state.readableListening = self2.listenerCount("readable") > 0;
      if (state.resumeScheduled && state[kPaused] === false) {
        state.flowing = true;
      } else if (self2.listenerCount("data") > 0) {
        self2.resume();
      } else if (!state.readableListening) {
        state.flowing = null;
      }
    }
    function nReadingNextTick(self2) {
      debug2("readable nexttick read 0");
      self2.read(0);
    }
    Readable.prototype.resume = function() {
      const state = this._readableState;
      if (!state.flowing) {
        debug2("resume");
        state.flowing = !state.readableListening;
        resume(this, state);
      }
      state[kPaused] = false;
      return this;
    };
    function resume(stream, state) {
      if (!state.resumeScheduled) {
        state.resumeScheduled = true;
        process2.nextTick(resume_, stream, state);
      }
    }
    function resume_(stream, state) {
      debug2("resume", state.reading);
      if (!state.reading) {
        stream.read(0);
      }
      state.resumeScheduled = false;
      stream.emit("resume");
      flow(stream);
      if (state.flowing && !state.reading) stream.read(0);
    }
    Readable.prototype.pause = function() {
      debug2("call pause flowing=%j", this._readableState.flowing);
      if (this._readableState.flowing !== false) {
        debug2("pause");
        this._readableState.flowing = false;
        this.emit("pause");
      }
      this._readableState[kPaused] = true;
      return this;
    };
    function flow(stream) {
      const state = stream._readableState;
      debug2("flow", state.flowing);
      while (state.flowing && stream.read() !== null) ;
    }
    Readable.prototype.wrap = function(stream) {
      let paused = false;
      stream.on("data", (chunk) => {
        if (!this.push(chunk) && stream.pause) {
          paused = true;
          stream.pause();
        }
      });
      stream.on("end", () => {
        this.push(null);
      });
      stream.on("error", (err) => {
        errorOrDestroy(this, err);
      });
      stream.on("close", () => {
        this.destroy();
      });
      stream.on("destroy", () => {
        this.destroy();
      });
      this._read = () => {
        if (paused && stream.resume) {
          paused = false;
          stream.resume();
        }
      };
      const streamKeys = ObjectKeys(stream);
      for (let j = 1; j < streamKeys.length; j++) {
        const i2 = streamKeys[j];
        if (this[i2] === void 0 && typeof stream[i2] === "function") {
          this[i2] = stream[i2].bind(stream);
        }
      }
      return this;
    };
    Readable.prototype[SymbolAsyncIterator] = function() {
      return streamToAsyncIterator(this);
    };
    Readable.prototype.iterator = function(options) {
      if (options !== void 0) {
        validateObject(options, "options");
      }
      return streamToAsyncIterator(this, options);
    };
    function streamToAsyncIterator(stream, options) {
      if (typeof stream.read !== "function") {
        stream = Readable.wrap(stream, {
          objectMode: true
        });
      }
      const iter = createAsyncIterator(stream, options);
      iter.stream = stream;
      return iter;
    }
    async function* createAsyncIterator(stream, options) {
      let callback = nop;
      function next(resolve) {
        if (this === stream) {
          callback();
          callback = nop;
        } else {
          callback = resolve;
        }
      }
      stream.on("readable", next);
      let error2;
      const cleanup = eos(
        stream,
        {
          writable: false
        },
        (err) => {
          error2 = err ? aggregateTwoErrors(error2, err) : null;
          callback();
          callback = nop;
        }
      );
      try {
        while (true) {
          const chunk = stream.destroyed ? null : stream.read();
          if (chunk !== null) {
            yield chunk;
          } else if (error2) {
            throw error2;
          } else if (error2 === null) {
            return;
          } else {
            await new Promise2(next);
          }
        }
      } catch (err) {
        error2 = aggregateTwoErrors(error2, err);
        throw error2;
      } finally {
        if ((error2 || (options === null || options === void 0 ? void 0 : options.destroyOnReturn) !== false) && (error2 === void 0 || stream._readableState.autoDestroy)) {
          destroyImpl.destroyer(stream, null);
        } else {
          stream.off("readable", next);
          cleanup();
        }
      }
    }
    ObjectDefineProperties(Readable.prototype, {
      readable: {
        __proto__: null,
        get() {
          const r = this._readableState;
          return !!r && r.readable !== false && !r.destroyed && !r.errorEmitted && !r.endEmitted;
        },
        set(val) {
          if (this._readableState) {
            this._readableState.readable = !!val;
          }
        }
      },
      readableDidRead: {
        __proto__: null,
        enumerable: false,
        get: function() {
          return this._readableState.dataEmitted;
        }
      },
      readableAborted: {
        __proto__: null,
        enumerable: false,
        get: function() {
          return !!(this._readableState.readable !== false && (this._readableState.destroyed || this._readableState.errored) && !this._readableState.endEmitted);
        }
      },
      readableHighWaterMark: {
        __proto__: null,
        enumerable: false,
        get: function() {
          return this._readableState.highWaterMark;
        }
      },
      readableBuffer: {
        __proto__: null,
        enumerable: false,
        get: function() {
          return this._readableState && this._readableState.buffer;
        }
      },
      readableFlowing: {
        __proto__: null,
        enumerable: false,
        get: function() {
          return this._readableState.flowing;
        },
        set: function(state) {
          if (this._readableState) {
            this._readableState.flowing = state;
          }
        }
      },
      readableLength: {
        __proto__: null,
        enumerable: false,
        get() {
          return this._readableState.length;
        }
      },
      readableObjectMode: {
        __proto__: null,
        enumerable: false,
        get() {
          return this._readableState ? this._readableState.objectMode : false;
        }
      },
      readableEncoding: {
        __proto__: null,
        enumerable: false,
        get() {
          return this._readableState ? this._readableState.encoding : null;
        }
      },
      errored: {
        __proto__: null,
        enumerable: false,
        get() {
          return this._readableState ? this._readableState.errored : null;
        }
      },
      closed: {
        __proto__: null,
        get() {
          return this._readableState ? this._readableState.closed : false;
        }
      },
      destroyed: {
        __proto__: null,
        enumerable: false,
        get() {
          return this._readableState ? this._readableState.destroyed : false;
        },
        set(value) {
          if (!this._readableState) {
            return;
          }
          this._readableState.destroyed = value;
        }
      },
      readableEnded: {
        __proto__: null,
        enumerable: false,
        get() {
          return this._readableState ? this._readableState.endEmitted : false;
        }
      }
    });
    ObjectDefineProperties(ReadableState.prototype, {
      // Legacy getter for `pipesCount`.
      pipesCount: {
        __proto__: null,
        get() {
          return this.pipes.length;
        }
      },
      // Legacy property for `paused`.
      paused: {
        __proto__: null,
        get() {
          return this[kPaused] !== false;
        },
        set(value) {
          this[kPaused] = !!value;
        }
      }
    });
    Readable._fromList = fromList;
    function fromList(n2, state) {
      if (state.length === 0) return null;
      let ret;
      if (state.objectMode) ret = state.buffer.shift();
      else if (!n2 || n2 >= state.length) {
        if (state.decoder) ret = state.buffer.join("");
        else if (state.buffer.length === 1) ret = state.buffer.first();
        else ret = state.buffer.concat(state.length);
        state.buffer.clear();
      } else {
        ret = state.buffer.consume(n2, state.decoder);
      }
      return ret;
    }
    function endReadable(stream) {
      const state = stream._readableState;
      debug2("endReadable", state.endEmitted);
      if (!state.endEmitted) {
        state.ended = true;
        process2.nextTick(endReadableNT, state, stream);
      }
    }
    function endReadableNT(state, stream) {
      debug2("endReadableNT", state.endEmitted, state.length);
      if (!state.errored && !state.closeEmitted && !state.endEmitted && state.length === 0) {
        state.endEmitted = true;
        stream.emit("end");
        if (stream.writable && stream.allowHalfOpen === false) {
          process2.nextTick(endWritableNT, stream);
        } else if (state.autoDestroy) {
          const wState = stream._writableState;
          const autoDestroy = !wState || wState.autoDestroy && // We don't expect the writable to ever 'finish'
          // if writable is explicitly set to false.
          (wState.finished || wState.writable === false);
          if (autoDestroy) {
            stream.destroy();
          }
        }
      }
    }
    function endWritableNT(stream) {
      const writable = stream.writable && !stream.writableEnded && !stream.destroyed;
      if (writable) {
        stream.end();
      }
    }
    Readable.from = function(iterable, opts) {
      return from(Readable, iterable, opts);
    };
    var webStreamsAdapters;
    function lazyWebStreams() {
      if (webStreamsAdapters === void 0) webStreamsAdapters = {};
      return webStreamsAdapters;
    }
    Readable.fromWeb = function(readableStream, options) {
      return lazyWebStreams().newStreamReadableFromReadableStream(readableStream, options);
    };
    Readable.toWeb = function(streamReadable, options) {
      return lazyWebStreams().newReadableStreamFromStreamReadable(streamReadable, options);
    };
    Readable.wrap = function(src, options) {
      var _ref, _src$readableObjectMo;
      return new Readable({
        objectMode: (_ref = (_src$readableObjectMo = src.readableObjectMode) !== null && _src$readableObjectMo !== void 0 ? _src$readableObjectMo : src.objectMode) !== null && _ref !== void 0 ? _ref : true,
        ...options,
        destroy(err, callback) {
          destroyImpl.destroyer(src, err);
          callback(err);
        }
      }).wrap(src);
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/writable.js
var require_writable = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/writable.js"(exports, module) {
    "use strict";
    var process2 = require_browser2();
    var {
      ArrayPrototypeSlice,
      Error: Error2,
      FunctionPrototypeSymbolHasInstance,
      ObjectDefineProperty,
      ObjectDefineProperties,
      ObjectSetPrototypeOf,
      StringPrototypeToLowerCase,
      Symbol: Symbol2,
      SymbolHasInstance
    } = require_primordials();
    module.exports = Writable;
    Writable.WritableState = WritableState;
    var { EventEmitter: EE } = require_events();
    var Stream = require_legacy().Stream;
    var { Buffer: Buffer3 } = require_buffer();
    var destroyImpl = require_destroy();
    var { addAbortSignal } = require_add_abort_signal();
    var { getHighWaterMark, getDefaultHighWaterMark } = require_state();
    var {
      ERR_INVALID_ARG_TYPE,
      ERR_METHOD_NOT_IMPLEMENTED,
      ERR_MULTIPLE_CALLBACK,
      ERR_STREAM_CANNOT_PIPE,
      ERR_STREAM_DESTROYED,
      ERR_STREAM_ALREADY_FINISHED,
      ERR_STREAM_NULL_VALUES,
      ERR_STREAM_WRITE_AFTER_END,
      ERR_UNKNOWN_ENCODING
    } = require_errors().codes;
    var { errorOrDestroy } = destroyImpl;
    ObjectSetPrototypeOf(Writable.prototype, Stream.prototype);
    ObjectSetPrototypeOf(Writable, Stream);
    function nop() {
    }
    var kOnFinished = Symbol2("kOnFinished");
    function WritableState(options, stream, isDuplex) {
      if (typeof isDuplex !== "boolean") isDuplex = stream instanceof require_duplex();
      this.objectMode = !!(options && options.objectMode);
      if (isDuplex) this.objectMode = this.objectMode || !!(options && options.writableObjectMode);
      this.highWaterMark = options ? getHighWaterMark(this, options, "writableHighWaterMark", isDuplex) : getDefaultHighWaterMark(false);
      this.finalCalled = false;
      this.needDrain = false;
      this.ending = false;
      this.ended = false;
      this.finished = false;
      this.destroyed = false;
      const noDecode = !!(options && options.decodeStrings === false);
      this.decodeStrings = !noDecode;
      this.defaultEncoding = options && options.defaultEncoding || "utf8";
      this.length = 0;
      this.writing = false;
      this.corked = 0;
      this.sync = true;
      this.bufferProcessing = false;
      this.onwrite = onwrite.bind(void 0, stream);
      this.writecb = null;
      this.writelen = 0;
      this.afterWriteTickInfo = null;
      resetBuffer(this);
      this.pendingcb = 0;
      this.constructed = true;
      this.prefinished = false;
      this.errorEmitted = false;
      this.emitClose = !options || options.emitClose !== false;
      this.autoDestroy = !options || options.autoDestroy !== false;
      this.errored = null;
      this.closed = false;
      this.closeEmitted = false;
      this[kOnFinished] = [];
    }
    function resetBuffer(state) {
      state.buffered = [];
      state.bufferedIndex = 0;
      state.allBuffers = true;
      state.allNoop = true;
    }
    WritableState.prototype.getBuffer = function getBuffer() {
      return ArrayPrototypeSlice(this.buffered, this.bufferedIndex);
    };
    ObjectDefineProperty(WritableState.prototype, "bufferedRequestCount", {
      __proto__: null,
      get() {
        return this.buffered.length - this.bufferedIndex;
      }
    });
    function Writable(options) {
      const isDuplex = this instanceof require_duplex();
      if (!isDuplex && !FunctionPrototypeSymbolHasInstance(Writable, this)) return new Writable(options);
      this._writableState = new WritableState(options, this, isDuplex);
      if (options) {
        if (typeof options.write === "function") this._write = options.write;
        if (typeof options.writev === "function") this._writev = options.writev;
        if (typeof options.destroy === "function") this._destroy = options.destroy;
        if (typeof options.final === "function") this._final = options.final;
        if (typeof options.construct === "function") this._construct = options.construct;
        if (options.signal) addAbortSignal(options.signal, this);
      }
      Stream.call(this, options);
      destroyImpl.construct(this, () => {
        const state = this._writableState;
        if (!state.writing) {
          clearBuffer(this, state);
        }
        finishMaybe(this, state);
      });
    }
    ObjectDefineProperty(Writable, SymbolHasInstance, {
      __proto__: null,
      value: function(object) {
        if (FunctionPrototypeSymbolHasInstance(this, object)) return true;
        if (this !== Writable) return false;
        return object && object._writableState instanceof WritableState;
      }
    });
    Writable.prototype.pipe = function() {
      errorOrDestroy(this, new ERR_STREAM_CANNOT_PIPE());
    };
    function _write(stream, chunk, encoding, cb) {
      const state = stream._writableState;
      if (typeof encoding === "function") {
        cb = encoding;
        encoding = state.defaultEncoding;
      } else {
        if (!encoding) encoding = state.defaultEncoding;
        else if (encoding !== "buffer" && !Buffer3.isEncoding(encoding)) throw new ERR_UNKNOWN_ENCODING(encoding);
        if (typeof cb !== "function") cb = nop;
      }
      if (chunk === null) {
        throw new ERR_STREAM_NULL_VALUES();
      } else if (!state.objectMode) {
        if (typeof chunk === "string") {
          if (state.decodeStrings !== false) {
            chunk = Buffer3.from(chunk, encoding);
            encoding = "buffer";
          }
        } else if (chunk instanceof Buffer3) {
          encoding = "buffer";
        } else if (Stream._isUint8Array(chunk)) {
          chunk = Stream._uint8ArrayToBuffer(chunk);
          encoding = "buffer";
        } else {
          throw new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "Uint8Array"], chunk);
        }
      }
      let err;
      if (state.ending) {
        err = new ERR_STREAM_WRITE_AFTER_END();
      } else if (state.destroyed) {
        err = new ERR_STREAM_DESTROYED("write");
      }
      if (err) {
        process2.nextTick(cb, err);
        errorOrDestroy(stream, err, true);
        return err;
      }
      state.pendingcb++;
      return writeOrBuffer(stream, state, chunk, encoding, cb);
    }
    Writable.prototype.write = function(chunk, encoding, cb) {
      return _write(this, chunk, encoding, cb) === true;
    };
    Writable.prototype.cork = function() {
      this._writableState.corked++;
    };
    Writable.prototype.uncork = function() {
      const state = this._writableState;
      if (state.corked) {
        state.corked--;
        if (!state.writing) clearBuffer(this, state);
      }
    };
    Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
      if (typeof encoding === "string") encoding = StringPrototypeToLowerCase(encoding);
      if (!Buffer3.isEncoding(encoding)) throw new ERR_UNKNOWN_ENCODING(encoding);
      this._writableState.defaultEncoding = encoding;
      return this;
    };
    function writeOrBuffer(stream, state, chunk, encoding, callback) {
      const len = state.objectMode ? 1 : chunk.length;
      state.length += len;
      const ret = state.length < state.highWaterMark;
      if (!ret) state.needDrain = true;
      if (state.writing || state.corked || state.errored || !state.constructed) {
        state.buffered.push({
          chunk,
          encoding,
          callback
        });
        if (state.allBuffers && encoding !== "buffer") {
          state.allBuffers = false;
        }
        if (state.allNoop && callback !== nop) {
          state.allNoop = false;
        }
      } else {
        state.writelen = len;
        state.writecb = callback;
        state.writing = true;
        state.sync = true;
        stream._write(chunk, encoding, state.onwrite);
        state.sync = false;
      }
      return ret && !state.errored && !state.destroyed;
    }
    function doWrite(stream, state, writev, len, chunk, encoding, cb) {
      state.writelen = len;
      state.writecb = cb;
      state.writing = true;
      state.sync = true;
      if (state.destroyed) state.onwrite(new ERR_STREAM_DESTROYED("write"));
      else if (writev) stream._writev(chunk, state.onwrite);
      else stream._write(chunk, encoding, state.onwrite);
      state.sync = false;
    }
    function onwriteError(stream, state, er, cb) {
      --state.pendingcb;
      cb(er);
      errorBuffer(state);
      errorOrDestroy(stream, er);
    }
    function onwrite(stream, er) {
      const state = stream._writableState;
      const sync = state.sync;
      const cb = state.writecb;
      if (typeof cb !== "function") {
        errorOrDestroy(stream, new ERR_MULTIPLE_CALLBACK());
        return;
      }
      state.writing = false;
      state.writecb = null;
      state.length -= state.writelen;
      state.writelen = 0;
      if (er) {
        er.stack;
        if (!state.errored) {
          state.errored = er;
        }
        if (stream._readableState && !stream._readableState.errored) {
          stream._readableState.errored = er;
        }
        if (sync) {
          process2.nextTick(onwriteError, stream, state, er, cb);
        } else {
          onwriteError(stream, state, er, cb);
        }
      } else {
        if (state.buffered.length > state.bufferedIndex) {
          clearBuffer(stream, state);
        }
        if (sync) {
          if (state.afterWriteTickInfo !== null && state.afterWriteTickInfo.cb === cb) {
            state.afterWriteTickInfo.count++;
          } else {
            state.afterWriteTickInfo = {
              count: 1,
              cb,
              stream,
              state
            };
            process2.nextTick(afterWriteTick, state.afterWriteTickInfo);
          }
        } else {
          afterWrite(stream, state, 1, cb);
        }
      }
    }
    function afterWriteTick({ stream, state, count, cb }) {
      state.afterWriteTickInfo = null;
      return afterWrite(stream, state, count, cb);
    }
    function afterWrite(stream, state, count, cb) {
      const needDrain = !state.ending && !stream.destroyed && state.length === 0 && state.needDrain;
      if (needDrain) {
        state.needDrain = false;
        stream.emit("drain");
      }
      while (count-- > 0) {
        state.pendingcb--;
        cb();
      }
      if (state.destroyed) {
        errorBuffer(state);
      }
      finishMaybe(stream, state);
    }
    function errorBuffer(state) {
      if (state.writing) {
        return;
      }
      for (let n2 = state.bufferedIndex; n2 < state.buffered.length; ++n2) {
        var _state$errored;
        const { chunk, callback } = state.buffered[n2];
        const len = state.objectMode ? 1 : chunk.length;
        state.length -= len;
        callback(
          (_state$errored = state.errored) !== null && _state$errored !== void 0 ? _state$errored : new ERR_STREAM_DESTROYED("write")
        );
      }
      const onfinishCallbacks = state[kOnFinished].splice(0);
      for (let i2 = 0; i2 < onfinishCallbacks.length; i2++) {
        var _state$errored2;
        onfinishCallbacks[i2](
          (_state$errored2 = state.errored) !== null && _state$errored2 !== void 0 ? _state$errored2 : new ERR_STREAM_DESTROYED("end")
        );
      }
      resetBuffer(state);
    }
    function clearBuffer(stream, state) {
      if (state.corked || state.bufferProcessing || state.destroyed || !state.constructed) {
        return;
      }
      const { buffered, bufferedIndex, objectMode } = state;
      const bufferedLength = buffered.length - bufferedIndex;
      if (!bufferedLength) {
        return;
      }
      let i2 = bufferedIndex;
      state.bufferProcessing = true;
      if (bufferedLength > 1 && stream._writev) {
        state.pendingcb -= bufferedLength - 1;
        const callback = state.allNoop ? nop : (err) => {
          for (let n2 = i2; n2 < buffered.length; ++n2) {
            buffered[n2].callback(err);
          }
        };
        const chunks = state.allNoop && i2 === 0 ? buffered : ArrayPrototypeSlice(buffered, i2);
        chunks.allBuffers = state.allBuffers;
        doWrite(stream, state, true, state.length, chunks, "", callback);
        resetBuffer(state);
      } else {
        do {
          const { chunk, encoding, callback } = buffered[i2];
          buffered[i2++] = null;
          const len = objectMode ? 1 : chunk.length;
          doWrite(stream, state, false, len, chunk, encoding, callback);
        } while (i2 < buffered.length && !state.writing);
        if (i2 === buffered.length) {
          resetBuffer(state);
        } else if (i2 > 256) {
          buffered.splice(0, i2);
          state.bufferedIndex = 0;
        } else {
          state.bufferedIndex = i2;
        }
      }
      state.bufferProcessing = false;
    }
    Writable.prototype._write = function(chunk, encoding, cb) {
      if (this._writev) {
        this._writev(
          [
            {
              chunk,
              encoding
            }
          ],
          cb
        );
      } else {
        throw new ERR_METHOD_NOT_IMPLEMENTED("_write()");
      }
    };
    Writable.prototype._writev = null;
    Writable.prototype.end = function(chunk, encoding, cb) {
      const state = this._writableState;
      if (typeof chunk === "function") {
        cb = chunk;
        chunk = null;
        encoding = null;
      } else if (typeof encoding === "function") {
        cb = encoding;
        encoding = null;
      }
      let err;
      if (chunk !== null && chunk !== void 0) {
        const ret = _write(this, chunk, encoding);
        if (ret instanceof Error2) {
          err = ret;
        }
      }
      if (state.corked) {
        state.corked = 1;
        this.uncork();
      }
      if (err) {
      } else if (!state.errored && !state.ending) {
        state.ending = true;
        finishMaybe(this, state, true);
        state.ended = true;
      } else if (state.finished) {
        err = new ERR_STREAM_ALREADY_FINISHED("end");
      } else if (state.destroyed) {
        err = new ERR_STREAM_DESTROYED("end");
      }
      if (typeof cb === "function") {
        if (err || state.finished) {
          process2.nextTick(cb, err);
        } else {
          state[kOnFinished].push(cb);
        }
      }
      return this;
    };
    function needFinish(state) {
      return state.ending && !state.destroyed && state.constructed && state.length === 0 && !state.errored && state.buffered.length === 0 && !state.finished && !state.writing && !state.errorEmitted && !state.closeEmitted;
    }
    function callFinal(stream, state) {
      let called = false;
      function onFinish(err) {
        if (called) {
          errorOrDestroy(stream, err !== null && err !== void 0 ? err : ERR_MULTIPLE_CALLBACK());
          return;
        }
        called = true;
        state.pendingcb--;
        if (err) {
          const onfinishCallbacks = state[kOnFinished].splice(0);
          for (let i2 = 0; i2 < onfinishCallbacks.length; i2++) {
            onfinishCallbacks[i2](err);
          }
          errorOrDestroy(stream, err, state.sync);
        } else if (needFinish(state)) {
          state.prefinished = true;
          stream.emit("prefinish");
          state.pendingcb++;
          process2.nextTick(finish, stream, state);
        }
      }
      state.sync = true;
      state.pendingcb++;
      try {
        stream._final(onFinish);
      } catch (err) {
        onFinish(err);
      }
      state.sync = false;
    }
    function prefinish(stream, state) {
      if (!state.prefinished && !state.finalCalled) {
        if (typeof stream._final === "function" && !state.destroyed) {
          state.finalCalled = true;
          callFinal(stream, state);
        } else {
          state.prefinished = true;
          stream.emit("prefinish");
        }
      }
    }
    function finishMaybe(stream, state, sync) {
      if (needFinish(state)) {
        prefinish(stream, state);
        if (state.pendingcb === 0) {
          if (sync) {
            state.pendingcb++;
            process2.nextTick(
              (stream2, state2) => {
                if (needFinish(state2)) {
                  finish(stream2, state2);
                } else {
                  state2.pendingcb--;
                }
              },
              stream,
              state
            );
          } else if (needFinish(state)) {
            state.pendingcb++;
            finish(stream, state);
          }
        }
      }
    }
    function finish(stream, state) {
      state.pendingcb--;
      state.finished = true;
      const onfinishCallbacks = state[kOnFinished].splice(0);
      for (let i2 = 0; i2 < onfinishCallbacks.length; i2++) {
        onfinishCallbacks[i2]();
      }
      stream.emit("finish");
      if (state.autoDestroy) {
        const rState = stream._readableState;
        const autoDestroy = !rState || rState.autoDestroy && // We don't expect the readable to ever 'end'
        // if readable is explicitly set to false.
        (rState.endEmitted || rState.readable === false);
        if (autoDestroy) {
          stream.destroy();
        }
      }
    }
    ObjectDefineProperties(Writable.prototype, {
      closed: {
        __proto__: null,
        get() {
          return this._writableState ? this._writableState.closed : false;
        }
      },
      destroyed: {
        __proto__: null,
        get() {
          return this._writableState ? this._writableState.destroyed : false;
        },
        set(value) {
          if (this._writableState) {
            this._writableState.destroyed = value;
          }
        }
      },
      writable: {
        __proto__: null,
        get() {
          const w = this._writableState;
          return !!w && w.writable !== false && !w.destroyed && !w.errored && !w.ending && !w.ended;
        },
        set(val) {
          if (this._writableState) {
            this._writableState.writable = !!val;
          }
        }
      },
      writableFinished: {
        __proto__: null,
        get() {
          return this._writableState ? this._writableState.finished : false;
        }
      },
      writableObjectMode: {
        __proto__: null,
        get() {
          return this._writableState ? this._writableState.objectMode : false;
        }
      },
      writableBuffer: {
        __proto__: null,
        get() {
          return this._writableState && this._writableState.getBuffer();
        }
      },
      writableEnded: {
        __proto__: null,
        get() {
          return this._writableState ? this._writableState.ending : false;
        }
      },
      writableNeedDrain: {
        __proto__: null,
        get() {
          const wState = this._writableState;
          if (!wState) return false;
          return !wState.destroyed && !wState.ending && wState.needDrain;
        }
      },
      writableHighWaterMark: {
        __proto__: null,
        get() {
          return this._writableState && this._writableState.highWaterMark;
        }
      },
      writableCorked: {
        __proto__: null,
        get() {
          return this._writableState ? this._writableState.corked : 0;
        }
      },
      writableLength: {
        __proto__: null,
        get() {
          return this._writableState && this._writableState.length;
        }
      },
      errored: {
        __proto__: null,
        enumerable: false,
        get() {
          return this._writableState ? this._writableState.errored : null;
        }
      },
      writableAborted: {
        __proto__: null,
        enumerable: false,
        get: function() {
          return !!(this._writableState.writable !== false && (this._writableState.destroyed || this._writableState.errored) && !this._writableState.finished);
        }
      }
    });
    var destroy = destroyImpl.destroy;
    Writable.prototype.destroy = function(err, cb) {
      const state = this._writableState;
      if (!state.destroyed && (state.bufferedIndex < state.buffered.length || state[kOnFinished].length)) {
        process2.nextTick(errorBuffer, state);
      }
      destroy.call(this, err, cb);
      return this;
    };
    Writable.prototype._undestroy = destroyImpl.undestroy;
    Writable.prototype._destroy = function(err, cb) {
      cb(err);
    };
    Writable.prototype[EE.captureRejectionSymbol] = function(err) {
      this.destroy(err);
    };
    var webStreamsAdapters;
    function lazyWebStreams() {
      if (webStreamsAdapters === void 0) webStreamsAdapters = {};
      return webStreamsAdapters;
    }
    Writable.fromWeb = function(writableStream, options) {
      return lazyWebStreams().newStreamWritableFromWritableStream(writableStream, options);
    };
    Writable.toWeb = function(streamWritable) {
      return lazyWebStreams().newWritableStreamFromStreamWritable(streamWritable);
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/duplexify.js
var require_duplexify = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/duplexify.js"(exports, module) {
    var process2 = require_browser2();
    var bufferModule = require_buffer();
    var {
      isReadable,
      isWritable,
      isIterable,
      isNodeStream,
      isReadableNodeStream,
      isWritableNodeStream,
      isDuplexNodeStream,
      isReadableStream: isReadableStream2,
      isWritableStream
    } = require_utils();
    var eos = require_end_of_stream();
    var {
      AbortError,
      codes: { ERR_INVALID_ARG_TYPE, ERR_INVALID_RETURN_VALUE }
    } = require_errors();
    var { destroyer } = require_destroy();
    var Duplex = require_duplex();
    var Readable = require_readable();
    var Writable = require_writable();
    var { createDeferredPromise } = require_util();
    var from = require_from();
    var Blob2 = globalThis.Blob || bufferModule.Blob;
    var isBlob = typeof Blob2 !== "undefined" ? function isBlob2(b) {
      return b instanceof Blob2;
    } : function isBlob2(b) {
      return false;
    };
    var AbortController2 = globalThis.AbortController || require_browser().AbortController;
    var { FunctionPrototypeCall } = require_primordials();
    var Duplexify = class extends Duplex {
      constructor(options) {
        super(options);
        if ((options === null || options === void 0 ? void 0 : options.readable) === false) {
          this._readableState.readable = false;
          this._readableState.ended = true;
          this._readableState.endEmitted = true;
        }
        if ((options === null || options === void 0 ? void 0 : options.writable) === false) {
          this._writableState.writable = false;
          this._writableState.ending = true;
          this._writableState.ended = true;
          this._writableState.finished = true;
        }
      }
    };
    module.exports = function duplexify(body, name) {
      if (isDuplexNodeStream(body)) {
        return body;
      }
      if (isReadableNodeStream(body)) {
        return _duplexify({
          readable: body
        });
      }
      if (isWritableNodeStream(body)) {
        return _duplexify({
          writable: body
        });
      }
      if (isNodeStream(body)) {
        return _duplexify({
          writable: false,
          readable: false
        });
      }
      if (isReadableStream2(body)) {
        return _duplexify({
          readable: Readable.fromWeb(body)
        });
      }
      if (isWritableStream(body)) {
        return _duplexify({
          writable: Writable.fromWeb(body)
        });
      }
      if (typeof body === "function") {
        const { value, write, final, destroy } = fromAsyncGen(body);
        if (isIterable(value)) {
          return from(Duplexify, value, {
            // TODO (ronag): highWaterMark?
            objectMode: true,
            write,
            final,
            destroy
          });
        }
        const then2 = value === null || value === void 0 ? void 0 : value.then;
        if (typeof then2 === "function") {
          let d;
          const promise = FunctionPrototypeCall(
            then2,
            value,
            (val) => {
              if (val != null) {
                throw new ERR_INVALID_RETURN_VALUE("nully", "body", val);
              }
            },
            (err) => {
              destroyer(d, err);
            }
          );
          return d = new Duplexify({
            // TODO (ronag): highWaterMark?
            objectMode: true,
            readable: false,
            write,
            final(cb) {
              final(async () => {
                try {
                  await promise;
                  process2.nextTick(cb, null);
                } catch (err) {
                  process2.nextTick(cb, err);
                }
              });
            },
            destroy
          });
        }
        throw new ERR_INVALID_RETURN_VALUE("Iterable, AsyncIterable or AsyncFunction", name, value);
      }
      if (isBlob(body)) {
        return duplexify(body.arrayBuffer());
      }
      if (isIterable(body)) {
        return from(Duplexify, body, {
          // TODO (ronag): highWaterMark?
          objectMode: true,
          writable: false
        });
      }
      if (isReadableStream2(body === null || body === void 0 ? void 0 : body.readable) && isWritableStream(body === null || body === void 0 ? void 0 : body.writable)) {
        return Duplexify.fromWeb(body);
      }
      if (typeof (body === null || body === void 0 ? void 0 : body.writable) === "object" || typeof (body === null || body === void 0 ? void 0 : body.readable) === "object") {
        const readable = body !== null && body !== void 0 && body.readable ? isReadableNodeStream(body === null || body === void 0 ? void 0 : body.readable) ? body === null || body === void 0 ? void 0 : body.readable : duplexify(body.readable) : void 0;
        const writable = body !== null && body !== void 0 && body.writable ? isWritableNodeStream(body === null || body === void 0 ? void 0 : body.writable) ? body === null || body === void 0 ? void 0 : body.writable : duplexify(body.writable) : void 0;
        return _duplexify({
          readable,
          writable
        });
      }
      const then = body === null || body === void 0 ? void 0 : body.then;
      if (typeof then === "function") {
        let d;
        FunctionPrototypeCall(
          then,
          body,
          (val) => {
            if (val != null) {
              d.push(val);
            }
            d.push(null);
          },
          (err) => {
            destroyer(d, err);
          }
        );
        return d = new Duplexify({
          objectMode: true,
          writable: false,
          read() {
          }
        });
      }
      throw new ERR_INVALID_ARG_TYPE(
        name,
        [
          "Blob",
          "ReadableStream",
          "WritableStream",
          "Stream",
          "Iterable",
          "AsyncIterable",
          "Function",
          "{ readable, writable } pair",
          "Promise"
        ],
        body
      );
    };
    function fromAsyncGen(fn) {
      let { promise, resolve } = createDeferredPromise();
      const ac = new AbortController2();
      const signal = ac.signal;
      const value = fn(
        (async function* () {
          while (true) {
            const _promise = promise;
            promise = null;
            const { chunk, done, cb } = await _promise;
            process2.nextTick(cb);
            if (done) return;
            if (signal.aborted)
              throw new AbortError(void 0, {
                cause: signal.reason
              });
            ({ promise, resolve } = createDeferredPromise());
            yield chunk;
          }
        })(),
        {
          signal
        }
      );
      return {
        value,
        write(chunk, encoding, cb) {
          const _resolve = resolve;
          resolve = null;
          _resolve({
            chunk,
            done: false,
            cb
          });
        },
        final(cb) {
          const _resolve = resolve;
          resolve = null;
          _resolve({
            done: true,
            cb
          });
        },
        destroy(err, cb) {
          ac.abort();
          cb(err);
        }
      };
    }
    function _duplexify(pair) {
      const r = pair.readable && typeof pair.readable.read !== "function" ? Readable.wrap(pair.readable) : pair.readable;
      const w = pair.writable;
      let readable = !!isReadable(r);
      let writable = !!isWritable(w);
      let ondrain;
      let onfinish;
      let onreadable;
      let onclose;
      let d;
      function onfinished(err) {
        const cb = onclose;
        onclose = null;
        if (cb) {
          cb(err);
        } else if (err) {
          d.destroy(err);
        }
      }
      d = new Duplexify({
        // TODO (ronag): highWaterMark?
        readableObjectMode: !!(r !== null && r !== void 0 && r.readableObjectMode),
        writableObjectMode: !!(w !== null && w !== void 0 && w.writableObjectMode),
        readable,
        writable
      });
      if (writable) {
        eos(w, (err) => {
          writable = false;
          if (err) {
            destroyer(r, err);
          }
          onfinished(err);
        });
        d._write = function(chunk, encoding, callback) {
          if (w.write(chunk, encoding)) {
            callback();
          } else {
            ondrain = callback;
          }
        };
        d._final = function(callback) {
          w.end();
          onfinish = callback;
        };
        w.on("drain", function() {
          if (ondrain) {
            const cb = ondrain;
            ondrain = null;
            cb();
          }
        });
        w.on("finish", function() {
          if (onfinish) {
            const cb = onfinish;
            onfinish = null;
            cb();
          }
        });
      }
      if (readable) {
        eos(r, (err) => {
          readable = false;
          if (err) {
            destroyer(r, err);
          }
          onfinished(err);
        });
        r.on("readable", function() {
          if (onreadable) {
            const cb = onreadable;
            onreadable = null;
            cb();
          }
        });
        r.on("end", function() {
          d.push(null);
        });
        d._read = function() {
          while (true) {
            const buf = r.read();
            if (buf === null) {
              onreadable = d._read;
              return;
            }
            if (!d.push(buf)) {
              return;
            }
          }
        };
      }
      d._destroy = function(err, callback) {
        if (!err && onclose !== null) {
          err = new AbortError();
        }
        onreadable = null;
        ondrain = null;
        onfinish = null;
        if (onclose === null) {
          callback(err);
        } else {
          onclose = callback;
          destroyer(w, err);
          destroyer(r, err);
        }
      };
      return d;
    }
  }
});

// node_modules/readable-stream/lib/internal/streams/duplex.js
var require_duplex = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/duplex.js"(exports, module) {
    "use strict";
    var {
      ObjectDefineProperties,
      ObjectGetOwnPropertyDescriptor,
      ObjectKeys,
      ObjectSetPrototypeOf
    } = require_primordials();
    module.exports = Duplex;
    var Readable = require_readable();
    var Writable = require_writable();
    ObjectSetPrototypeOf(Duplex.prototype, Readable.prototype);
    ObjectSetPrototypeOf(Duplex, Readable);
    {
      const keys = ObjectKeys(Writable.prototype);
      for (let i2 = 0; i2 < keys.length; i2++) {
        const method = keys[i2];
        if (!Duplex.prototype[method]) Duplex.prototype[method] = Writable.prototype[method];
      }
    }
    function Duplex(options) {
      if (!(this instanceof Duplex)) return new Duplex(options);
      Readable.call(this, options);
      Writable.call(this, options);
      if (options) {
        this.allowHalfOpen = options.allowHalfOpen !== false;
        if (options.readable === false) {
          this._readableState.readable = false;
          this._readableState.ended = true;
          this._readableState.endEmitted = true;
        }
        if (options.writable === false) {
          this._writableState.writable = false;
          this._writableState.ending = true;
          this._writableState.ended = true;
          this._writableState.finished = true;
        }
      } else {
        this.allowHalfOpen = true;
      }
    }
    ObjectDefineProperties(Duplex.prototype, {
      writable: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writable")
      },
      writableHighWaterMark: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableHighWaterMark")
      },
      writableObjectMode: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableObjectMode")
      },
      writableBuffer: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableBuffer")
      },
      writableLength: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableLength")
      },
      writableFinished: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableFinished")
      },
      writableCorked: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableCorked")
      },
      writableEnded: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableEnded")
      },
      writableNeedDrain: {
        __proto__: null,
        ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableNeedDrain")
      },
      destroyed: {
        __proto__: null,
        get() {
          if (this._readableState === void 0 || this._writableState === void 0) {
            return false;
          }
          return this._readableState.destroyed && this._writableState.destroyed;
        },
        set(value) {
          if (this._readableState && this._writableState) {
            this._readableState.destroyed = value;
            this._writableState.destroyed = value;
          }
        }
      }
    });
    var webStreamsAdapters;
    function lazyWebStreams() {
      if (webStreamsAdapters === void 0) webStreamsAdapters = {};
      return webStreamsAdapters;
    }
    Duplex.fromWeb = function(pair, options) {
      return lazyWebStreams().newStreamDuplexFromReadableWritablePair(pair, options);
    };
    Duplex.toWeb = function(duplex) {
      return lazyWebStreams().newReadableWritablePairFromDuplex(duplex);
    };
    var duplexify;
    Duplex.from = function(body) {
      if (!duplexify) {
        duplexify = require_duplexify();
      }
      return duplexify(body, "body");
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/transform.js
var require_transform = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/transform.js"(exports, module) {
    "use strict";
    var { ObjectSetPrototypeOf, Symbol: Symbol2 } = require_primordials();
    module.exports = Transform2;
    var { ERR_METHOD_NOT_IMPLEMENTED } = require_errors().codes;
    var Duplex = require_duplex();
    var { getHighWaterMark } = require_state();
    ObjectSetPrototypeOf(Transform2.prototype, Duplex.prototype);
    ObjectSetPrototypeOf(Transform2, Duplex);
    var kCallback = Symbol2("kCallback");
    function Transform2(options) {
      if (!(this instanceof Transform2)) return new Transform2(options);
      const readableHighWaterMark = options ? getHighWaterMark(this, options, "readableHighWaterMark", true) : null;
      if (readableHighWaterMark === 0) {
        options = {
          ...options,
          highWaterMark: null,
          readableHighWaterMark,
          // TODO (ronag): 0 is not optimal since we have
          // a "bug" where we check needDrain before calling _write and not after.
          // Refs: https://github.com/nodejs/node/pull/32887
          // Refs: https://github.com/nodejs/node/pull/35941
          writableHighWaterMark: options.writableHighWaterMark || 0
        };
      }
      Duplex.call(this, options);
      this._readableState.sync = false;
      this[kCallback] = null;
      if (options) {
        if (typeof options.transform === "function") this._transform = options.transform;
        if (typeof options.flush === "function") this._flush = options.flush;
      }
      this.on("prefinish", prefinish);
    }
    function final(cb) {
      if (typeof this._flush === "function" && !this.destroyed) {
        this._flush((er, data) => {
          if (er) {
            if (cb) {
              cb(er);
            } else {
              this.destroy(er);
            }
            return;
          }
          if (data != null) {
            this.push(data);
          }
          this.push(null);
          if (cb) {
            cb();
          }
        });
      } else {
        this.push(null);
        if (cb) {
          cb();
        }
      }
    }
    function prefinish() {
      if (this._final !== final) {
        final.call(this);
      }
    }
    Transform2.prototype._final = final;
    Transform2.prototype._transform = function(chunk, encoding, callback) {
      throw new ERR_METHOD_NOT_IMPLEMENTED("_transform()");
    };
    Transform2.prototype._write = function(chunk, encoding, callback) {
      const rState = this._readableState;
      const wState = this._writableState;
      const length = rState.length;
      this._transform(chunk, encoding, (err, val) => {
        if (err) {
          callback(err);
          return;
        }
        if (val != null) {
          this.push(val);
        }
        if (wState.ended || // Backwards compat.
        length === rState.length || // Backwards compat.
        rState.length < rState.highWaterMark) {
          callback();
        } else {
          this[kCallback] = callback;
        }
      });
    };
    Transform2.prototype._read = function() {
      if (this[kCallback]) {
        const callback = this[kCallback];
        this[kCallback] = null;
        callback();
      }
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/passthrough.js
var require_passthrough = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/passthrough.js"(exports, module) {
    "use strict";
    var { ObjectSetPrototypeOf } = require_primordials();
    module.exports = PassThrough;
    var Transform2 = require_transform();
    ObjectSetPrototypeOf(PassThrough.prototype, Transform2.prototype);
    ObjectSetPrototypeOf(PassThrough, Transform2);
    function PassThrough(options) {
      if (!(this instanceof PassThrough)) return new PassThrough(options);
      Transform2.call(this, options);
    }
    PassThrough.prototype._transform = function(chunk, encoding, cb) {
      cb(null, chunk);
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/pipeline.js
var require_pipeline = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/pipeline.js"(exports, module) {
    var process2 = require_browser2();
    var { ArrayIsArray, Promise: Promise2, SymbolAsyncIterator, SymbolDispose } = require_primordials();
    var eos = require_end_of_stream();
    var { once } = require_util();
    var destroyImpl = require_destroy();
    var Duplex = require_duplex();
    var {
      aggregateTwoErrors,
      codes: {
        ERR_INVALID_ARG_TYPE,
        ERR_INVALID_RETURN_VALUE,
        ERR_MISSING_ARGS,
        ERR_STREAM_DESTROYED,
        ERR_STREAM_PREMATURE_CLOSE
      },
      AbortError
    } = require_errors();
    var { validateFunction, validateAbortSignal } = require_validators();
    var {
      isIterable,
      isReadable,
      isReadableNodeStream,
      isNodeStream,
      isTransformStream,
      isWebStream,
      isReadableStream: isReadableStream2,
      isReadableFinished
    } = require_utils();
    var AbortController2 = globalThis.AbortController || require_browser().AbortController;
    var PassThrough;
    var Readable;
    var addAbortListener;
    function destroyer(stream, reading, writing) {
      let finished = false;
      stream.on("close", () => {
        finished = true;
      });
      const cleanup = eos(
        stream,
        {
          readable: reading,
          writable: writing
        },
        (err) => {
          finished = !err;
        }
      );
      return {
        destroy: (err) => {
          if (finished) return;
          finished = true;
          destroyImpl.destroyer(stream, err || new ERR_STREAM_DESTROYED("pipe"));
        },
        cleanup
      };
    }
    function popCallback(streams) {
      validateFunction(streams[streams.length - 1], "streams[stream.length - 1]");
      return streams.pop();
    }
    function makeAsyncIterable(val) {
      if (isIterable(val)) {
        return val;
      } else if (isReadableNodeStream(val)) {
        return fromReadable(val);
      }
      throw new ERR_INVALID_ARG_TYPE("val", ["Readable", "Iterable", "AsyncIterable"], val);
    }
    async function* fromReadable(val) {
      if (!Readable) {
        Readable = require_readable();
      }
      yield* Readable.prototype[SymbolAsyncIterator].call(val);
    }
    async function pumpToNode(iterable, writable, finish, { end }) {
      let error2;
      let onresolve = null;
      const resume = (err) => {
        if (err) {
          error2 = err;
        }
        if (onresolve) {
          const callback = onresolve;
          onresolve = null;
          callback();
        }
      };
      const wait2 = () => new Promise2((resolve, reject) => {
        if (error2) {
          reject(error2);
        } else {
          onresolve = () => {
            if (error2) {
              reject(error2);
            } else {
              resolve();
            }
          };
        }
      });
      writable.on("drain", resume);
      const cleanup = eos(
        writable,
        {
          readable: false
        },
        resume
      );
      try {
        if (writable.writableNeedDrain) {
          await wait2();
        }
        for await (const chunk of iterable) {
          if (!writable.write(chunk)) {
            await wait2();
          }
        }
        if (end) {
          writable.end();
          await wait2();
        }
        finish();
      } catch (err) {
        finish(error2 !== err ? aggregateTwoErrors(error2, err) : err);
      } finally {
        cleanup();
        writable.off("drain", resume);
      }
    }
    async function pumpToWeb(readable, writable, finish, { end }) {
      if (isTransformStream(writable)) {
        writable = writable.writable;
      }
      const writer = writable.getWriter();
      try {
        for await (const chunk of readable) {
          await writer.ready;
          writer.write(chunk).catch(() => {
          });
        }
        await writer.ready;
        if (end) {
          await writer.close();
        }
        finish();
      } catch (err) {
        try {
          await writer.abort(err);
          finish(err);
        } catch (err2) {
          finish(err2);
        }
      }
    }
    function pipeline(...streams) {
      return pipelineImpl(streams, once(popCallback(streams)));
    }
    function pipelineImpl(streams, callback, opts) {
      if (streams.length === 1 && ArrayIsArray(streams[0])) {
        streams = streams[0];
      }
      if (streams.length < 2) {
        throw new ERR_MISSING_ARGS("streams");
      }
      const ac = new AbortController2();
      const signal = ac.signal;
      const outerSignal = opts === null || opts === void 0 ? void 0 : opts.signal;
      const lastStreamCleanup = [];
      validateAbortSignal(outerSignal, "options.signal");
      function abort() {
        finishImpl(new AbortError());
      }
      addAbortListener = addAbortListener || require_util().addAbortListener;
      let disposable;
      if (outerSignal) {
        disposable = addAbortListener(outerSignal, abort);
      }
      let error2;
      let value;
      const destroys = [];
      let finishCount = 0;
      function finish(err) {
        finishImpl(err, --finishCount === 0);
      }
      function finishImpl(err, final) {
        var _disposable;
        if (err && (!error2 || error2.code === "ERR_STREAM_PREMATURE_CLOSE")) {
          error2 = err;
        }
        if (!error2 && !final) {
          return;
        }
        while (destroys.length) {
          destroys.shift()(error2);
        }
        ;
        (_disposable = disposable) === null || _disposable === void 0 ? void 0 : _disposable[SymbolDispose]();
        ac.abort();
        if (final) {
          if (!error2) {
            lastStreamCleanup.forEach((fn) => fn());
          }
          process2.nextTick(callback, error2, value);
        }
      }
      let ret;
      for (let i2 = 0; i2 < streams.length; i2++) {
        const stream = streams[i2];
        const reading = i2 < streams.length - 1;
        const writing = i2 > 0;
        const end = reading || (opts === null || opts === void 0 ? void 0 : opts.end) !== false;
        const isLastStream = i2 === streams.length - 1;
        if (isNodeStream(stream)) {
          let onError2 = function(err) {
            if (err && err.name !== "AbortError" && err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
              finish(err);
            }
          };
          var onError = onError2;
          if (end) {
            const { destroy, cleanup } = destroyer(stream, reading, writing);
            destroys.push(destroy);
            if (isReadable(stream) && isLastStream) {
              lastStreamCleanup.push(cleanup);
            }
          }
          stream.on("error", onError2);
          if (isReadable(stream) && isLastStream) {
            lastStreamCleanup.push(() => {
              stream.removeListener("error", onError2);
            });
          }
        }
        if (i2 === 0) {
          if (typeof stream === "function") {
            ret = stream({
              signal
            });
            if (!isIterable(ret)) {
              throw new ERR_INVALID_RETURN_VALUE("Iterable, AsyncIterable or Stream", "source", ret);
            }
          } else if (isIterable(stream) || isReadableNodeStream(stream) || isTransformStream(stream)) {
            ret = stream;
          } else {
            ret = Duplex.from(stream);
          }
        } else if (typeof stream === "function") {
          if (isTransformStream(ret)) {
            var _ret;
            ret = makeAsyncIterable((_ret = ret) === null || _ret === void 0 ? void 0 : _ret.readable);
          } else {
            ret = makeAsyncIterable(ret);
          }
          ret = stream(ret, {
            signal
          });
          if (reading) {
            if (!isIterable(ret, true)) {
              throw new ERR_INVALID_RETURN_VALUE("AsyncIterable", `transform[${i2 - 1}]`, ret);
            }
          } else {
            var _ret2;
            if (!PassThrough) {
              PassThrough = require_passthrough();
            }
            const pt = new PassThrough({
              objectMode: true
            });
            const then = (_ret2 = ret) === null || _ret2 === void 0 ? void 0 : _ret2.then;
            if (typeof then === "function") {
              finishCount++;
              then.call(
                ret,
                (val) => {
                  value = val;
                  if (val != null) {
                    pt.write(val);
                  }
                  if (end) {
                    pt.end();
                  }
                  process2.nextTick(finish);
                },
                (err) => {
                  pt.destroy(err);
                  process2.nextTick(finish, err);
                }
              );
            } else if (isIterable(ret, true)) {
              finishCount++;
              pumpToNode(ret, pt, finish, {
                end
              });
            } else if (isReadableStream2(ret) || isTransformStream(ret)) {
              const toRead = ret.readable || ret;
              finishCount++;
              pumpToNode(toRead, pt, finish, {
                end
              });
            } else {
              throw new ERR_INVALID_RETURN_VALUE("AsyncIterable or Promise", "destination", ret);
            }
            ret = pt;
            const { destroy, cleanup } = destroyer(ret, false, true);
            destroys.push(destroy);
            if (isLastStream) {
              lastStreamCleanup.push(cleanup);
            }
          }
        } else if (isNodeStream(stream)) {
          if (isReadableNodeStream(ret)) {
            finishCount += 2;
            const cleanup = pipe(ret, stream, finish, {
              end
            });
            if (isReadable(stream) && isLastStream) {
              lastStreamCleanup.push(cleanup);
            }
          } else if (isTransformStream(ret) || isReadableStream2(ret)) {
            const toRead = ret.readable || ret;
            finishCount++;
            pumpToNode(toRead, stream, finish, {
              end
            });
          } else if (isIterable(ret)) {
            finishCount++;
            pumpToNode(ret, stream, finish, {
              end
            });
          } else {
            throw new ERR_INVALID_ARG_TYPE(
              "val",
              ["Readable", "Iterable", "AsyncIterable", "ReadableStream", "TransformStream"],
              ret
            );
          }
          ret = stream;
        } else if (isWebStream(stream)) {
          if (isReadableNodeStream(ret)) {
            finishCount++;
            pumpToWeb(makeAsyncIterable(ret), stream, finish, {
              end
            });
          } else if (isReadableStream2(ret) || isIterable(ret)) {
            finishCount++;
            pumpToWeb(ret, stream, finish, {
              end
            });
          } else if (isTransformStream(ret)) {
            finishCount++;
            pumpToWeb(ret.readable, stream, finish, {
              end
            });
          } else {
            throw new ERR_INVALID_ARG_TYPE(
              "val",
              ["Readable", "Iterable", "AsyncIterable", "ReadableStream", "TransformStream"],
              ret
            );
          }
          ret = stream;
        } else {
          ret = Duplex.from(stream);
        }
      }
      if (signal !== null && signal !== void 0 && signal.aborted || outerSignal !== null && outerSignal !== void 0 && outerSignal.aborted) {
        process2.nextTick(abort);
      }
      return ret;
    }
    function pipe(src, dst, finish, { end }) {
      let ended = false;
      dst.on("close", () => {
        if (!ended) {
          finish(new ERR_STREAM_PREMATURE_CLOSE());
        }
      });
      src.pipe(dst, {
        end: false
      });
      if (end) {
        let endFn2 = function() {
          ended = true;
          dst.end();
        };
        var endFn = endFn2;
        if (isReadableFinished(src)) {
          process2.nextTick(endFn2);
        } else {
          src.once("end", endFn2);
        }
      } else {
        finish();
      }
      eos(
        src,
        {
          readable: true,
          writable: false
        },
        (err) => {
          const rState = src._readableState;
          if (err && err.code === "ERR_STREAM_PREMATURE_CLOSE" && rState && rState.ended && !rState.errored && !rState.errorEmitted) {
            src.once("end", finish).once("error", finish);
          } else {
            finish(err);
          }
        }
      );
      return eos(
        dst,
        {
          readable: false,
          writable: true
        },
        finish
      );
    }
    module.exports = {
      pipelineImpl,
      pipeline
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/compose.js
var require_compose = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/compose.js"(exports, module) {
    "use strict";
    var { pipeline } = require_pipeline();
    var Duplex = require_duplex();
    var { destroyer } = require_destroy();
    var {
      isNodeStream,
      isReadable,
      isWritable,
      isWebStream,
      isTransformStream,
      isWritableStream,
      isReadableStream: isReadableStream2
    } = require_utils();
    var {
      AbortError,
      codes: { ERR_INVALID_ARG_VALUE, ERR_MISSING_ARGS }
    } = require_errors();
    var eos = require_end_of_stream();
    module.exports = function compose(...streams) {
      if (streams.length === 0) {
        throw new ERR_MISSING_ARGS("streams");
      }
      if (streams.length === 1) {
        return Duplex.from(streams[0]);
      }
      const orgStreams = [...streams];
      if (typeof streams[0] === "function") {
        streams[0] = Duplex.from(streams[0]);
      }
      if (typeof streams[streams.length - 1] === "function") {
        const idx = streams.length - 1;
        streams[idx] = Duplex.from(streams[idx]);
      }
      for (let n2 = 0; n2 < streams.length; ++n2) {
        if (!isNodeStream(streams[n2]) && !isWebStream(streams[n2])) {
          continue;
        }
        if (n2 < streams.length - 1 && !(isReadable(streams[n2]) || isReadableStream2(streams[n2]) || isTransformStream(streams[n2]))) {
          throw new ERR_INVALID_ARG_VALUE(`streams[${n2}]`, orgStreams[n2], "must be readable");
        }
        if (n2 > 0 && !(isWritable(streams[n2]) || isWritableStream(streams[n2]) || isTransformStream(streams[n2]))) {
          throw new ERR_INVALID_ARG_VALUE(`streams[${n2}]`, orgStreams[n2], "must be writable");
        }
      }
      let ondrain;
      let onfinish;
      let onreadable;
      let onclose;
      let d;
      function onfinished(err) {
        const cb = onclose;
        onclose = null;
        if (cb) {
          cb(err);
        } else if (err) {
          d.destroy(err);
        } else if (!readable && !writable) {
          d.destroy();
        }
      }
      const head = streams[0];
      const tail = pipeline(streams, onfinished);
      const writable = !!(isWritable(head) || isWritableStream(head) || isTransformStream(head));
      const readable = !!(isReadable(tail) || isReadableStream2(tail) || isTransformStream(tail));
      d = new Duplex({
        // TODO (ronag): highWaterMark?
        writableObjectMode: !!(head !== null && head !== void 0 && head.writableObjectMode),
        readableObjectMode: !!(tail !== null && tail !== void 0 && tail.readableObjectMode),
        writable,
        readable
      });
      if (writable) {
        if (isNodeStream(head)) {
          d._write = function(chunk, encoding, callback) {
            if (head.write(chunk, encoding)) {
              callback();
            } else {
              ondrain = callback;
            }
          };
          d._final = function(callback) {
            head.end();
            onfinish = callback;
          };
          head.on("drain", function() {
            if (ondrain) {
              const cb = ondrain;
              ondrain = null;
              cb();
            }
          });
        } else if (isWebStream(head)) {
          const writable2 = isTransformStream(head) ? head.writable : head;
          const writer = writable2.getWriter();
          d._write = async function(chunk, encoding, callback) {
            try {
              await writer.ready;
              writer.write(chunk).catch(() => {
              });
              callback();
            } catch (err) {
              callback(err);
            }
          };
          d._final = async function(callback) {
            try {
              await writer.ready;
              writer.close().catch(() => {
              });
              onfinish = callback;
            } catch (err) {
              callback(err);
            }
          };
        }
        const toRead = isTransformStream(tail) ? tail.readable : tail;
        eos(toRead, () => {
          if (onfinish) {
            const cb = onfinish;
            onfinish = null;
            cb();
          }
        });
      }
      if (readable) {
        if (isNodeStream(tail)) {
          tail.on("readable", function() {
            if (onreadable) {
              const cb = onreadable;
              onreadable = null;
              cb();
            }
          });
          tail.on("end", function() {
            d.push(null);
          });
          d._read = function() {
            while (true) {
              const buf = tail.read();
              if (buf === null) {
                onreadable = d._read;
                return;
              }
              if (!d.push(buf)) {
                return;
              }
            }
          };
        } else if (isWebStream(tail)) {
          const readable2 = isTransformStream(tail) ? tail.readable : tail;
          const reader = readable2.getReader();
          d._read = async function() {
            while (true) {
              try {
                const { value, done } = await reader.read();
                if (!d.push(value)) {
                  return;
                }
                if (done) {
                  d.push(null);
                  return;
                }
              } catch {
                return;
              }
            }
          };
        }
      }
      d._destroy = function(err, callback) {
        if (!err && onclose !== null) {
          err = new AbortError();
        }
        onreadable = null;
        ondrain = null;
        onfinish = null;
        if (onclose === null) {
          callback(err);
        } else {
          onclose = callback;
          if (isNodeStream(tail)) {
            destroyer(tail, err);
          }
        }
      };
      return d;
    };
  }
});

// node_modules/readable-stream/lib/internal/streams/operators.js
var require_operators = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/operators.js"(exports, module) {
    "use strict";
    var AbortController2 = globalThis.AbortController || require_browser().AbortController;
    var {
      codes: { ERR_INVALID_ARG_VALUE, ERR_INVALID_ARG_TYPE, ERR_MISSING_ARGS, ERR_OUT_OF_RANGE },
      AbortError
    } = require_errors();
    var { validateAbortSignal, validateInteger, validateObject } = require_validators();
    var kWeakHandler = require_primordials().Symbol("kWeak");
    var kResistStopPropagation = require_primordials().Symbol("kResistStopPropagation");
    var { finished } = require_end_of_stream();
    var staticCompose = require_compose();
    var { addAbortSignalNoValidate } = require_add_abort_signal();
    var { isWritable, isNodeStream } = require_utils();
    var { deprecate } = require_util();
    var {
      ArrayPrototypePush,
      Boolean: Boolean2,
      MathFloor,
      Number: Number2,
      NumberIsNaN,
      Promise: Promise2,
      PromiseReject,
      PromiseResolve,
      PromisePrototypeThen,
      Symbol: Symbol2
    } = require_primordials();
    var kEmpty = Symbol2("kEmpty");
    var kEof = Symbol2("kEof");
    function compose(stream, options) {
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      if (isNodeStream(stream) && !isWritable(stream)) {
        throw new ERR_INVALID_ARG_VALUE("stream", stream, "must be writable");
      }
      const composedStream = staticCompose(this, stream);
      if (options !== null && options !== void 0 && options.signal) {
        addAbortSignalNoValidate(options.signal, composedStream);
      }
      return composedStream;
    }
    function map(fn, options) {
      if (typeof fn !== "function") {
        throw new ERR_INVALID_ARG_TYPE("fn", ["Function", "AsyncFunction"], fn);
      }
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      let concurrency = 1;
      if ((options === null || options === void 0 ? void 0 : options.concurrency) != null) {
        concurrency = MathFloor(options.concurrency);
      }
      let highWaterMark = concurrency - 1;
      if ((options === null || options === void 0 ? void 0 : options.highWaterMark) != null) {
        highWaterMark = MathFloor(options.highWaterMark);
      }
      validateInteger(concurrency, "options.concurrency", 1);
      validateInteger(highWaterMark, "options.highWaterMark", 0);
      highWaterMark += concurrency;
      return async function* map2() {
        const signal = require_util().AbortSignalAny(
          [options === null || options === void 0 ? void 0 : options.signal].filter(Boolean2)
        );
        const stream = this;
        const queue = [];
        const signalOpt = {
          signal
        };
        let next;
        let resume;
        let done = false;
        let cnt = 0;
        function onCatch() {
          done = true;
          afterItemProcessed();
        }
        function afterItemProcessed() {
          cnt -= 1;
          maybeResume();
        }
        function maybeResume() {
          if (resume && !done && cnt < concurrency && queue.length < highWaterMark) {
            resume();
            resume = null;
          }
        }
        async function pump() {
          try {
            for await (let val of stream) {
              if (done) {
                return;
              }
              if (signal.aborted) {
                throw new AbortError();
              }
              try {
                val = fn(val, signalOpt);
                if (val === kEmpty) {
                  continue;
                }
                val = PromiseResolve(val);
              } catch (err) {
                val = PromiseReject(err);
              }
              cnt += 1;
              PromisePrototypeThen(val, afterItemProcessed, onCatch);
              queue.push(val);
              if (next) {
                next();
                next = null;
              }
              if (!done && (queue.length >= highWaterMark || cnt >= concurrency)) {
                await new Promise2((resolve) => {
                  resume = resolve;
                });
              }
            }
            queue.push(kEof);
          } catch (err) {
            const val = PromiseReject(err);
            PromisePrototypeThen(val, afterItemProcessed, onCatch);
            queue.push(val);
          } finally {
            done = true;
            if (next) {
              next();
              next = null;
            }
          }
        }
        pump();
        try {
          while (true) {
            while (queue.length > 0) {
              const val = await queue[0];
              if (val === kEof) {
                return;
              }
              if (signal.aborted) {
                throw new AbortError();
              }
              if (val !== kEmpty) {
                yield val;
              }
              queue.shift();
              maybeResume();
            }
            await new Promise2((resolve) => {
              next = resolve;
            });
          }
        } finally {
          done = true;
          if (resume) {
            resume();
            resume = null;
          }
        }
      }.call(this);
    }
    function asIndexedPairs(options = void 0) {
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      return async function* asIndexedPairs2() {
        let index = 0;
        for await (const val of this) {
          var _options$signal;
          if (options !== null && options !== void 0 && (_options$signal = options.signal) !== null && _options$signal !== void 0 && _options$signal.aborted) {
            throw new AbortError({
              cause: options.signal.reason
            });
          }
          yield [index++, val];
        }
      }.call(this);
    }
    async function some(fn, options = void 0) {
      for await (const unused of filter.call(this, fn, options)) {
        return true;
      }
      return false;
    }
    async function every(fn, options = void 0) {
      if (typeof fn !== "function") {
        throw new ERR_INVALID_ARG_TYPE("fn", ["Function", "AsyncFunction"], fn);
      }
      return !await some.call(
        this,
        async (...args) => {
          return !await fn(...args);
        },
        options
      );
    }
    async function find(fn, options) {
      for await (const result of filter.call(this, fn, options)) {
        return result;
      }
      return void 0;
    }
    async function forEach2(fn, options) {
      if (typeof fn !== "function") {
        throw new ERR_INVALID_ARG_TYPE("fn", ["Function", "AsyncFunction"], fn);
      }
      async function forEachFn(value, options2) {
        await fn(value, options2);
        return kEmpty;
      }
      for await (const unused of map.call(this, forEachFn, options)) ;
    }
    function filter(fn, options) {
      if (typeof fn !== "function") {
        throw new ERR_INVALID_ARG_TYPE("fn", ["Function", "AsyncFunction"], fn);
      }
      async function filterFn(value, options2) {
        if (await fn(value, options2)) {
          return value;
        }
        return kEmpty;
      }
      return map.call(this, filterFn, options);
    }
    var ReduceAwareErrMissingArgs = class extends ERR_MISSING_ARGS {
      constructor() {
        super("reduce");
        this.message = "Reduce of an empty stream requires an initial value";
      }
    };
    async function reduce(reducer, initialValue, options) {
      var _options$signal2;
      if (typeof reducer !== "function") {
        throw new ERR_INVALID_ARG_TYPE("reducer", ["Function", "AsyncFunction"], reducer);
      }
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      let hasInitialValue = arguments.length > 1;
      if (options !== null && options !== void 0 && (_options$signal2 = options.signal) !== null && _options$signal2 !== void 0 && _options$signal2.aborted) {
        const err = new AbortError(void 0, {
          cause: options.signal.reason
        });
        this.once("error", () => {
        });
        await finished(this.destroy(err));
        throw err;
      }
      const ac = new AbortController2();
      const signal = ac.signal;
      if (options !== null && options !== void 0 && options.signal) {
        const opts = {
          once: true,
          [kWeakHandler]: this,
          [kResistStopPropagation]: true
        };
        options.signal.addEventListener("abort", () => ac.abort(), opts);
      }
      let gotAnyItemFromStream = false;
      try {
        for await (const value of this) {
          var _options$signal3;
          gotAnyItemFromStream = true;
          if (options !== null && options !== void 0 && (_options$signal3 = options.signal) !== null && _options$signal3 !== void 0 && _options$signal3.aborted) {
            throw new AbortError();
          }
          if (!hasInitialValue) {
            initialValue = value;
            hasInitialValue = true;
          } else {
            initialValue = await reducer(initialValue, value, {
              signal
            });
          }
        }
        if (!gotAnyItemFromStream && !hasInitialValue) {
          throw new ReduceAwareErrMissingArgs();
        }
      } finally {
        ac.abort();
      }
      return initialValue;
    }
    async function toArray2(options) {
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      const result = [];
      for await (const val of this) {
        var _options$signal4;
        if (options !== null && options !== void 0 && (_options$signal4 = options.signal) !== null && _options$signal4 !== void 0 && _options$signal4.aborted) {
          throw new AbortError(void 0, {
            cause: options.signal.reason
          });
        }
        ArrayPrototypePush(result, val);
      }
      return result;
    }
    function flatMap2(fn, options) {
      const values2 = map.call(this, fn, options);
      return async function* flatMap3() {
        for await (const val of values2) {
          yield* val;
        }
      }.call(this);
    }
    function toIntegerOrInfinity(number3) {
      number3 = Number2(number3);
      if (NumberIsNaN(number3)) {
        return 0;
      }
      if (number3 < 0) {
        throw new ERR_OUT_OF_RANGE("number", ">= 0", number3);
      }
      return number3;
    }
    function drop(number3, options = void 0) {
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      number3 = toIntegerOrInfinity(number3);
      return async function* drop2() {
        var _options$signal5;
        if (options !== null && options !== void 0 && (_options$signal5 = options.signal) !== null && _options$signal5 !== void 0 && _options$signal5.aborted) {
          throw new AbortError();
        }
        for await (const val of this) {
          var _options$signal6;
          if (options !== null && options !== void 0 && (_options$signal6 = options.signal) !== null && _options$signal6 !== void 0 && _options$signal6.aborted) {
            throw new AbortError();
          }
          if (number3-- <= 0) {
            yield val;
          }
        }
      }.call(this);
    }
    function take2(number3, options = void 0) {
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      number3 = toIntegerOrInfinity(number3);
      return async function* take3() {
        var _options$signal7;
        if (options !== null && options !== void 0 && (_options$signal7 = options.signal) !== null && _options$signal7 !== void 0 && _options$signal7.aborted) {
          throw new AbortError();
        }
        for await (const val of this) {
          var _options$signal8;
          if (options !== null && options !== void 0 && (_options$signal8 = options.signal) !== null && _options$signal8 !== void 0 && _options$signal8.aborted) {
            throw new AbortError();
          }
          if (number3-- > 0) {
            yield val;
          }
          if (number3 <= 0) {
            return;
          }
        }
      }.call(this);
    }
    module.exports.streamReturningOperators = {
      asIndexedPairs: deprecate(asIndexedPairs, "readable.asIndexedPairs will be removed in a future version."),
      drop,
      filter,
      flatMap: flatMap2,
      map,
      take: take2,
      compose
    };
    module.exports.promiseReturningOperators = {
      every,
      forEach: forEach2,
      reduce,
      toArray: toArray2,
      some,
      find
    };
  }
});

// node_modules/readable-stream/lib/stream/promises.js
var require_promises = __commonJS({
  "node_modules/readable-stream/lib/stream/promises.js"(exports, module) {
    "use strict";
    var { ArrayPrototypePop, Promise: Promise2 } = require_primordials();
    var { isIterable, isNodeStream, isWebStream } = require_utils();
    var { pipelineImpl: pl } = require_pipeline();
    var { finished } = require_end_of_stream();
    require_stream();
    function pipeline(...streams) {
      return new Promise2((resolve, reject) => {
        let signal;
        let end;
        const lastArg = streams[streams.length - 1];
        if (lastArg && typeof lastArg === "object" && !isNodeStream(lastArg) && !isIterable(lastArg) && !isWebStream(lastArg)) {
          const options = ArrayPrototypePop(streams);
          signal = options.signal;
          end = options.end;
        }
        pl(
          streams,
          (err, value) => {
            if (err) {
              reject(err);
            } else {
              resolve(value);
            }
          },
          {
            signal,
            end
          }
        );
      });
    }
    module.exports = {
      finished,
      pipeline
    };
  }
});

// node_modules/readable-stream/lib/stream.js
var require_stream = __commonJS({
  "node_modules/readable-stream/lib/stream.js"(exports, module) {
    "use strict";
    var { Buffer: Buffer3 } = require_buffer();
    var { ObjectDefineProperty, ObjectKeys, ReflectApply } = require_primordials();
    var {
      promisify: { custom: customPromisify }
    } = require_util();
    var { streamReturningOperators, promiseReturningOperators } = require_operators();
    var {
      codes: { ERR_ILLEGAL_CONSTRUCTOR }
    } = require_errors();
    var compose = require_compose();
    var { setDefaultHighWaterMark, getDefaultHighWaterMark } = require_state();
    var { pipeline } = require_pipeline();
    var { destroyer } = require_destroy();
    var eos = require_end_of_stream();
    var promises = require_promises();
    var utils = require_utils();
    var Stream = module.exports = require_legacy().Stream;
    Stream.isDestroyed = utils.isDestroyed;
    Stream.isDisturbed = utils.isDisturbed;
    Stream.isErrored = utils.isErrored;
    Stream.isReadable = utils.isReadable;
    Stream.isWritable = utils.isWritable;
    Stream.Readable = require_readable();
    for (const key of ObjectKeys(streamReturningOperators)) {
      let fn = function(...args) {
        if (new.target) {
          throw ERR_ILLEGAL_CONSTRUCTOR();
        }
        return Stream.Readable.from(ReflectApply(op, this, args));
      };
      const op = streamReturningOperators[key];
      ObjectDefineProperty(fn, "name", {
        __proto__: null,
        value: op.name
      });
      ObjectDefineProperty(fn, "length", {
        __proto__: null,
        value: op.length
      });
      ObjectDefineProperty(Stream.Readable.prototype, key, {
        __proto__: null,
        value: fn,
        enumerable: false,
        configurable: true,
        writable: true
      });
    }
    for (const key of ObjectKeys(promiseReturningOperators)) {
      let fn = function(...args) {
        if (new.target) {
          throw ERR_ILLEGAL_CONSTRUCTOR();
        }
        return ReflectApply(op, this, args);
      };
      const op = promiseReturningOperators[key];
      ObjectDefineProperty(fn, "name", {
        __proto__: null,
        value: op.name
      });
      ObjectDefineProperty(fn, "length", {
        __proto__: null,
        value: op.length
      });
      ObjectDefineProperty(Stream.Readable.prototype, key, {
        __proto__: null,
        value: fn,
        enumerable: false,
        configurable: true,
        writable: true
      });
    }
    Stream.Writable = require_writable();
    Stream.Duplex = require_duplex();
    Stream.Transform = require_transform();
    Stream.PassThrough = require_passthrough();
    Stream.pipeline = pipeline;
    var { addAbortSignal } = require_add_abort_signal();
    Stream.addAbortSignal = addAbortSignal;
    Stream.finished = eos;
    Stream.destroy = destroyer;
    Stream.compose = compose;
    Stream.setDefaultHighWaterMark = setDefaultHighWaterMark;
    Stream.getDefaultHighWaterMark = getDefaultHighWaterMark;
    ObjectDefineProperty(Stream, "promises", {
      __proto__: null,
      configurable: true,
      enumerable: true,
      get() {
        return promises;
      }
    });
    ObjectDefineProperty(pipeline, customPromisify, {
      __proto__: null,
      enumerable: true,
      get() {
        return promises.pipeline;
      }
    });
    ObjectDefineProperty(eos, customPromisify, {
      __proto__: null,
      enumerable: true,
      get() {
        return promises.finished;
      }
    });
    Stream.Stream = Stream;
    Stream._isUint8Array = function isUint8Array(value) {
      return value instanceof Uint8Array;
    };
    Stream._uint8ArrayToBuffer = function _uint8ArrayToBuffer(chunk) {
      return Buffer3.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    };
  }
});

// node_modules/readable-stream/lib/ours/browser.js
var require_browser3 = __commonJS({
  "node_modules/readable-stream/lib/ours/browser.js"(exports, module) {
    "use strict";
    var CustomStream = require_stream();
    var promises = require_promises();
    var originalDestroy = CustomStream.Readable.destroy;
    module.exports = CustomStream.Readable;
    module.exports._uint8ArrayToBuffer = CustomStream._uint8ArrayToBuffer;
    module.exports._isUint8Array = CustomStream._isUint8Array;
    module.exports.isDisturbed = CustomStream.isDisturbed;
    module.exports.isErrored = CustomStream.isErrored;
    module.exports.isReadable = CustomStream.isReadable;
    module.exports.Readable = CustomStream.Readable;
    module.exports.Writable = CustomStream.Writable;
    module.exports.Duplex = CustomStream.Duplex;
    module.exports.Transform = CustomStream.Transform;
    module.exports.PassThrough = CustomStream.PassThrough;
    module.exports.addAbortSignal = CustomStream.addAbortSignal;
    module.exports.finished = CustomStream.finished;
    module.exports.destroy = CustomStream.destroy;
    module.exports.destroy = originalDestroy;
    module.exports.pipeline = CustomStream.pipeline;
    module.exports.compose = CustomStream.compose;
    Object.defineProperty(CustomStream, "promises", {
      configurable: true,
      enumerable: true,
      get() {
        return promises;
      }
    });
    module.exports.Stream = CustomStream.Stream;
    module.exports.default = module.exports;
  }
});

// node_modules/rdf-dataset-ext/toStream.js
var require_toStream = __commonJS({
  "node_modules/rdf-dataset-ext/toStream.js"(exports, module) {
    var { Readable } = require_browser3();
    function toStream4(dataset2) {
      const iterator = dataset2[Symbol.iterator]();
      const stream = new Readable({
        objectMode: true,
        read: () => {
          for (; ; ) {
            const quad3 = iterator.next().value;
            if (!quad3) {
              stream.push(null);
              return;
            }
            if (!stream.push(quad3)) {
              return;
            }
          }
        }
      });
      return stream;
    }
    module.exports = toStream4;
  }
});

// web/shims/util.js
var util_exports = {};
__export(util_exports, {
  default: () => util_default,
  inherits: () => inherits,
  inspect: () => inspect,
  promisify: () => promisify
});
var promisify, inherits, inspect, util_default;
var init_util = __esm({
  "web/shims/util.js"() {
    promisify = (fn) => (...args) => new Promise((resolve, reject) => fn(...args, (err, value) => err ? reject(err) : resolve(value)));
    inherits = () => {
    };
    inspect = (value) => String(value);
    util_default = { promisify, inherits, inspect };
  }
});

// node_modules/rdf-dataset-ext/fromStream.js
var require_fromStream = __commonJS({
  "node_modules/rdf-dataset-ext/fromStream.js"(exports, module) {
    var { promisify: promisify2 } = (init_util(), __toCommonJS(util_exports));
    var { finished } = require_browser3();
    async function fromStream3(dataset2, stream) {
      stream.on("data", (quad3) => dataset2.add(quad3));
      await promisify2(finished)(stream);
      return dataset2;
    }
    module.exports = fromStream3;
  }
});

// node_modules/rdf-dataset-ext/node_modules/rdf-canonize/lib/IdentifierIssuer.js
var require_IdentifierIssuer = __commonJS({
  "node_modules/rdf-dataset-ext/node_modules/rdf-canonize/lib/IdentifierIssuer.js"(exports, module) {
    "use strict";
    module.exports = class IdentifierIssuer {
      /**
       * Creates a new IdentifierIssuer. A IdentifierIssuer issues unique
       * identifiers, keeping track of any previously issued identifiers.
       *
       * @param prefix the prefix to use ('<prefix><counter>').
       * @param existing an existing Map to use.
       * @param counter the counter to use.
       */
      constructor(prefix, existing = /* @__PURE__ */ new Map(), counter = 0) {
        this.prefix = prefix;
        this._existing = existing;
        this.counter = counter;
      }
      /**
       * Copies this IdentifierIssuer.
       *
       * @return a copy of this IdentifierIssuer.
       */
      clone() {
        const { prefix, _existing, counter } = this;
        return new IdentifierIssuer(prefix, new Map(_existing), counter);
      }
      /**
       * Gets the new identifier for the given old identifier, where if no old
       * identifier is given a new identifier will be generated.
       *
       * @param [old] the old identifier to get the new identifier for.
       *
       * @return the new identifier.
       */
      getId(old) {
        const existing = old && this._existing.get(old);
        if (existing) {
          return existing;
        }
        const identifier = this.prefix + this.counter;
        this.counter++;
        if (old) {
          this._existing.set(old, identifier);
        }
        return identifier;
      }
      /**
       * Returns true if the given old identifer has already been assigned a new
       * identifier.
       *
       * @param old the old identifier to check.
       *
       * @return true if the old identifier has been assigned a new identifier,
       *   false if not.
       */
      hasId(old) {
        return this._existing.has(old);
      }
      /**
       * Returns all of the IDs that have been issued new IDs in the order in
       * which they were issued new IDs.
       *
       * @return the list of old IDs that has been issued new IDs in order.
       */
      getOldIds() {
        return [...this._existing.keys()];
      }
    };
  }
});

// node_modules/setimmediate/setImmediate.js
var require_setImmediate = __commonJS({
  "node_modules/setimmediate/setImmediate.js"(exports) {
    (function(global2, undefined2) {
      "use strict";
      if (global2.setImmediate) {
        return;
      }
      var nextHandle = 1;
      var tasksByHandle = {};
      var currentlyRunningATask = false;
      var doc = global2.document;
      var registerImmediate;
      function setImmediate(callback) {
        if (typeof callback !== "function") {
          callback = new Function("" + callback);
        }
        var args = new Array(arguments.length - 1);
        for (var i2 = 0; i2 < args.length; i2++) {
          args[i2] = arguments[i2 + 1];
        }
        var task = { callback, args };
        tasksByHandle[nextHandle] = task;
        registerImmediate(nextHandle);
        return nextHandle++;
      }
      function clearImmediate(handle) {
        delete tasksByHandle[handle];
      }
      function run(task) {
        var callback = task.callback;
        var args = task.args;
        switch (args.length) {
          case 0:
            callback();
            break;
          case 1:
            callback(args[0]);
            break;
          case 2:
            callback(args[0], args[1]);
            break;
          case 3:
            callback(args[0], args[1], args[2]);
            break;
          default:
            callback.apply(undefined2, args);
            break;
        }
      }
      function runIfPresent(handle) {
        if (currentlyRunningATask) {
          setTimeout(runIfPresent, 0, handle);
        } else {
          var task = tasksByHandle[handle];
          if (task) {
            currentlyRunningATask = true;
            try {
              run(task);
            } finally {
              clearImmediate(handle);
              currentlyRunningATask = false;
            }
          }
        }
      }
      function installNextTickImplementation() {
        registerImmediate = function(handle) {
          process.nextTick(function() {
            runIfPresent(handle);
          });
        };
      }
      function canUsePostMessage() {
        if (global2.postMessage && !global2.importScripts) {
          var postMessageIsAsynchronous = true;
          var oldOnMessage = global2.onmessage;
          global2.onmessage = function() {
            postMessageIsAsynchronous = false;
          };
          global2.postMessage("", "*");
          global2.onmessage = oldOnMessage;
          return postMessageIsAsynchronous;
        }
      }
      function installPostMessageImplementation() {
        var messagePrefix = "setImmediate$" + Math.random() + "$";
        var onGlobalMessage = function(event) {
          if (event.source === global2 && typeof event.data === "string" && event.data.indexOf(messagePrefix) === 0) {
            runIfPresent(+event.data.slice(messagePrefix.length));
          }
        };
        if (global2.addEventListener) {
          global2.addEventListener("message", onGlobalMessage, false);
        } else {
          global2.attachEvent("onmessage", onGlobalMessage);
        }
        registerImmediate = function(handle) {
          global2.postMessage(messagePrefix + handle, "*");
        };
      }
      function installMessageChannelImplementation() {
        var channel = new MessageChannel();
        channel.port1.onmessage = function(event) {
          var handle = event.data;
          runIfPresent(handle);
        };
        registerImmediate = function(handle) {
          channel.port2.postMessage(handle);
        };
      }
      function installReadyStateChangeImplementation() {
        var html = doc.documentElement;
        registerImmediate = function(handle) {
          var script = doc.createElement("script");
          script.onreadystatechange = function() {
            runIfPresent(handle);
            script.onreadystatechange = null;
            html.removeChild(script);
            script = null;
          };
          html.appendChild(script);
        };
      }
      function installSetTimeoutImplementation() {
        registerImmediate = function(handle) {
          setTimeout(runIfPresent, 0, handle);
        };
      }
      var attachTo = Object.getPrototypeOf && Object.getPrototypeOf(global2);
      attachTo = attachTo && attachTo.setTimeout ? attachTo : global2;
      if ({}.toString.call(global2.process) === "[object process]") {
        installNextTickImplementation();
      } else if (canUsePostMessage()) {
        installPostMessageImplementation();
      } else if (global2.MessageChannel) {
        installMessageChannelImplementation();
      } else if (doc && "onreadystatechange" in doc.createElement("script")) {
        installReadyStateChangeImplementation();
      } else {
        installSetTimeoutImplementation();
      }
      attachTo.setImmediate = setImmediate;
      attachTo.clearImmediate = clearImmediate;
    })(typeof self === "undefined" ? typeof global === "undefined" ? exports : global : self);
  }
});

// node_modules/rdf-dataset-ext/node_modules/rdf-canonize/lib/MessageDigest-browser.js
var require_MessageDigest_browser = __commonJS({
  "node_modules/rdf-dataset-ext/node_modules/rdf-canonize/lib/MessageDigest-browser.js"(exports, module) {
    "use strict";
    require_setImmediate();
    var crypto2 = self.crypto || self.msCrypto;
    module.exports = class MessageDigest {
      /**
       * Creates a new MessageDigest.
       *
       * @param algorithm the algorithm to use.
       */
      constructor(algorithm) {
        if (!(crypto2 && crypto2.subtle)) {
          throw new Error("crypto.subtle not found.");
        }
        if (algorithm === "sha256") {
          this.algorithm = { name: "SHA-256" };
        } else if (algorithm === "sha1") {
          this.algorithm = { name: "SHA-1" };
        } else {
          throw new Error(`Unsupported algorithm "${algorithm}".`);
        }
        this._content = "";
      }
      update(msg) {
        this._content += msg;
      }
      async digest() {
        const data = new TextEncoder().encode(this._content);
        const buffer = new Uint8Array(
          await crypto2.subtle.digest(this.algorithm, data)
        );
        let hex = "";
        for (let i2 = 0; i2 < buffer.length; ++i2) {
          hex += buffer[i2].toString(16).padStart(2, "0");
        }
        return hex;
      }
    };
  }
});

// node_modules/rdf-dataset-ext/node_modules/rdf-canonize/lib/Permuter.js
var require_Permuter = __commonJS({
  "node_modules/rdf-dataset-ext/node_modules/rdf-canonize/lib/Permuter.js"(exports, module) {
    "use strict";
    module.exports = class Permuter {
      /**
       * A Permuter iterates over all possible permutations of the given array
       * of elements.
       *
       * @param list the array of elements to iterate over.
       */
      constructor(list) {
        this.current = list.sort();
        this.done = false;
        this.dir = /* @__PURE__ */ new Map();
        for (let i2 = 0; i2 < list.length; ++i2) {
          this.dir.set(list[i2], true);
        }
      }
      /**
       * Returns true if there is another permutation.
       *
       * @return true if there is another permutation, false if not.
       */
      hasNext() {
        return !this.done;
      }
      /**
       * Gets the next permutation. Call hasNext() to ensure there is another one
       * first.
       *
       * @return the next permutation.
       */
      next() {
        const { current, dir } = this;
        const rval = current.slice();
        let k = null;
        let pos = 0;
        const length = current.length;
        for (let i2 = 0; i2 < length; ++i2) {
          const element = current[i2];
          const left = dir.get(element);
          if ((k === null || element > k) && (left && i2 > 0 && element > current[i2 - 1] || !left && i2 < length - 1 && element > current[i2 + 1])) {
            k = element;
            pos = i2;
          }
        }
        if (k === null) {
          this.done = true;
        } else {
          const swap = dir.get(k) ? pos - 1 : pos + 1;
          current[pos] = current[swap];
          current[swap] = k;
          for (const element of current) {
            if (element > k) {
              dir.set(element, !dir.get(element));
            }
          }
        }
        return rval;
      }
    };
  }
});

// node_modules/rdf-dataset-ext/node_modules/rdf-canonize/lib/NQuads.js
var require_NQuads = __commonJS({
  "node_modules/rdf-dataset-ext/node_modules/rdf-canonize/lib/NQuads.js"(exports, module) {
    "use strict";
    var RDF3 = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
    var RDF_LANGSTRING = RDF3 + "langString";
    var XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";
    var TYPE_NAMED_NODE = "NamedNode";
    var TYPE_BLANK_NODE = "BlankNode";
    var TYPE_LITERAL = "Literal";
    var TYPE_DEFAULT_GRAPH = "DefaultGraph";
    var REGEX = {};
    (() => {
      const iri4 = "(?:<([^:]+:[^>]*)>)";
      const PN_CHARS_BASE = "A-Za-z\xC0-\xD6\xD8-\xF6\xF8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD";
      const PN_CHARS_U = PN_CHARS_BASE + "_";
      const PN_CHARS = PN_CHARS_U + "0-9-\xB7\u0300-\u036F\u203F-\u2040";
      const BLANK_NODE_LABEL = "(_:(?:[" + PN_CHARS_U + "0-9])(?:(?:[" + PN_CHARS + ".])*(?:[" + PN_CHARS + "]))?)";
      const bnode = BLANK_NODE_LABEL;
      const plain = '"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"';
      const datatype = "(?:\\^\\^" + iri4 + ")";
      const language = "(?:@([a-zA-Z]+(?:-[a-zA-Z0-9]+)*))";
      const literal4 = "(?:" + plain + "(?:" + datatype + "|" + language + ")?)";
      const ws = "[ \\t]+";
      const wso = "[ \\t]*";
      const subject = "(?:" + iri4 + "|" + bnode + ")" + ws;
      const property = iri4 + ws;
      const object = "(?:" + iri4 + "|" + bnode + "|" + literal4 + ")" + wso;
      const graphName = "(?:\\.|(?:(?:" + iri4 + "|" + bnode + ")" + wso + "\\.))";
      REGEX.eoln = /(?:\r\n)|(?:\n)|(?:\r)/g;
      REGEX.empty = new RegExp("^" + wso + "$");
      REGEX.quad = new RegExp(
        "^" + wso + subject + property + object + graphName + wso + "$"
      );
    })();
    module.exports = class NQuads {
      /**
       * Parses RDF in the form of N-Quads.
       *
       * @param input the N-Quads input to parse.
       *
       * @return an RDF dataset (an array of quads per http://rdf.js.org/).
       */
      static parse(input) {
        const dataset2 = [];
        const graphs = {};
        const lines = input.split(REGEX.eoln);
        let lineNumber = 0;
        for (const line of lines) {
          lineNumber++;
          if (REGEX.empty.test(line)) {
            continue;
          }
          const match = line.match(REGEX.quad);
          if (match === null) {
            throw new Error("N-Quads parse error on line " + lineNumber + ".");
          }
          const quad3 = { subject: null, predicate: null, object: null, graph: null };
          if (match[1] !== void 0) {
            quad3.subject = { termType: TYPE_NAMED_NODE, value: match[1] };
          } else {
            quad3.subject = { termType: TYPE_BLANK_NODE, value: match[2] };
          }
          quad3.predicate = { termType: TYPE_NAMED_NODE, value: match[3] };
          if (match[4] !== void 0) {
            quad3.object = { termType: TYPE_NAMED_NODE, value: match[4] };
          } else if (match[5] !== void 0) {
            quad3.object = { termType: TYPE_BLANK_NODE, value: match[5] };
          } else {
            quad3.object = {
              termType: TYPE_LITERAL,
              value: void 0,
              datatype: {
                termType: TYPE_NAMED_NODE
              }
            };
            if (match[7] !== void 0) {
              quad3.object.datatype.value = match[7];
            } else if (match[8] !== void 0) {
              quad3.object.datatype.value = RDF_LANGSTRING;
              quad3.object.language = match[8];
            } else {
              quad3.object.datatype.value = XSD_STRING;
            }
            quad3.object.value = _unescape(match[6]);
          }
          if (match[9] !== void 0) {
            quad3.graph = {
              termType: TYPE_NAMED_NODE,
              value: match[9]
            };
          } else if (match[10] !== void 0) {
            quad3.graph = {
              termType: TYPE_BLANK_NODE,
              value: match[10]
            };
          } else {
            quad3.graph = {
              termType: TYPE_DEFAULT_GRAPH,
              value: ""
            };
          }
          if (!(quad3.graph.value in graphs)) {
            graphs[quad3.graph.value] = [quad3];
            dataset2.push(quad3);
          } else {
            let unique = true;
            const quads = graphs[quad3.graph.value];
            for (const q of quads) {
              if (_compareTriples(q, quad3)) {
                unique = false;
                break;
              }
            }
            if (unique) {
              quads.push(quad3);
              dataset2.push(quad3);
            }
          }
        }
        return dataset2;
      }
      /**
       * Converts an RDF dataset to N-Quads.
       *
       * @param dataset (array of quads) the RDF dataset to convert.
       *
       * @return the N-Quads string.
       */
      static serialize(dataset2) {
        if (!Array.isArray(dataset2)) {
          dataset2 = NQuads.legacyDatasetToQuads(dataset2);
        }
        const quads = [];
        for (const quad3 of dataset2) {
          quads.push(NQuads.serializeQuad(quad3));
        }
        return quads.sort().join("");
      }
      /**
       * Converts RDF quad components to an N-Quad string (a single quad).
       *
       * @param {Object} s - N-Quad subject component.
       * @param {Object} p - N-Quad predicate component.
       * @param {Object} o - N-Quad object component.
       * @param {Object} g - N-Quad graph component.
       *
       * @return {string} the N-Quad.
       */
      static serializeQuadComponents(s, p, o2, g) {
        let nquad = "";
        if (s.termType === TYPE_NAMED_NODE) {
          nquad += `<${s.value}>`;
        } else {
          nquad += `${s.value}`;
        }
        nquad += ` <${p.value}> `;
        if (o2.termType === TYPE_NAMED_NODE) {
          nquad += `<${o2.value}>`;
        } else if (o2.termType === TYPE_BLANK_NODE) {
          nquad += o2.value;
        } else {
          nquad += `"${_escape(o2.value)}"`;
          if (o2.datatype.value === RDF_LANGSTRING) {
            if (o2.language) {
              nquad += `@${o2.language}`;
            }
          } else if (o2.datatype.value !== XSD_STRING) {
            nquad += `^^<${o2.datatype.value}>`;
          }
        }
        if (g.termType === TYPE_NAMED_NODE) {
          nquad += ` <${g.value}>`;
        } else if (g.termType === TYPE_BLANK_NODE) {
          nquad += ` ${g.value}`;
        }
        nquad += " .\n";
        return nquad;
      }
      /**
       * Converts an RDF quad to an N-Quad string (a single quad).
       *
       * @param quad the RDF quad convert.
       *
       * @return the N-Quad string.
       */
      static serializeQuad(quad3) {
        return NQuads.serializeQuadComponents(
          quad3.subject,
          quad3.predicate,
          quad3.object,
          quad3.graph
        );
      }
      /**
       * Converts a legacy-formatted dataset to an array of quads dataset per
       * http://rdf.js.org/.
       *
       * @param dataset the legacy dataset to convert.
       *
       * @return the array of quads dataset.
       */
      static legacyDatasetToQuads(dataset2) {
        const quads = [];
        const termTypeMap = {
          "blank node": TYPE_BLANK_NODE,
          IRI: TYPE_NAMED_NODE,
          literal: TYPE_LITERAL
        };
        for (const graphName in dataset2) {
          const triples = dataset2[graphName];
          triples.forEach((triple) => {
            const quad3 = {};
            for (const componentName in triple) {
              const oldComponent = triple[componentName];
              const newComponent = {
                termType: termTypeMap[oldComponent.type],
                value: oldComponent.value
              };
              if (newComponent.termType === TYPE_LITERAL) {
                newComponent.datatype = {
                  termType: TYPE_NAMED_NODE
                };
                if ("datatype" in oldComponent) {
                  newComponent.datatype.value = oldComponent.datatype;
                }
                if ("language" in oldComponent) {
                  if (!("datatype" in oldComponent)) {
                    newComponent.datatype.value = RDF_LANGSTRING;
                  }
                  newComponent.language = oldComponent.language;
                } else if (!("datatype" in oldComponent)) {
                  newComponent.datatype.value = XSD_STRING;
                }
              }
              quad3[componentName] = newComponent;
            }
            if (graphName === "@default") {
              quad3.graph = {
                termType: TYPE_DEFAULT_GRAPH,
                value: ""
              };
            } else {
              quad3.graph = {
                termType: graphName.startsWith("_:") ? TYPE_BLANK_NODE : TYPE_NAMED_NODE,
                value: graphName
              };
            }
            quads.push(quad3);
          });
        }
        return quads;
      }
    };
    function _compareTriples(t1, t2) {
      if (!(t1.subject.termType === t2.subject.termType && t1.object.termType === t2.object.termType)) {
        return false;
      }
      if (!(t1.subject.value === t2.subject.value && t1.predicate.value === t2.predicate.value && t1.object.value === t2.object.value)) {
        return false;
      }
      if (t1.object.termType !== TYPE_LITERAL) {
        return true;
      }
      return t1.object.datatype.termType === t2.object.datatype.termType && t1.object.language === t2.object.language && t1.object.datatype.value === t2.object.datatype.value;
    }
    var _escapeRegex = /["\\\n\r]/g;
    function _escape(s) {
      return s.replace(_escapeRegex, function(match) {
        switch (match) {
          case '"':
            return '\\"';
          case "\\":
            return "\\\\";
          case "\n":
            return "\\n";
          case "\r":
            return "\\r";
        }
      });
    }
    var _unescapeRegex = /(?:\\([tbnrf"'\\]))|(?:\\u([0-9A-Fa-f]{4}))|(?:\\U([0-9A-Fa-f]{8}))/g;
    function _unescape(s) {
      return s.replace(_unescapeRegex, function(match, code, u2, U) {
        if (code) {
          switch (code) {
            case "t":
              return "	";
            case "b":
              return "\b";
            case "n":
              return "\n";
            case "r":
              return "\r";
            case "f":
              return "\f";
            case '"':
              return '"';
            case "'":
              return "'";
            case "\\":
              return "\\";
          }
        }
        if (u2) {
          return String.fromCharCode(parseInt(u2, 16));
        }
        if (U) {
          throw new Error("Unsupported U escape");
        }
      });
    }
  }
});

// node_modules/rdf-dataset-ext/node_modules/rdf-canonize/lib/URDNA2015Sync.js
var require_URDNA2015Sync = __commonJS({
  "node_modules/rdf-dataset-ext/node_modules/rdf-canonize/lib/URDNA2015Sync.js"(exports, module) {
    "use strict";
    var IdentifierIssuer = require_IdentifierIssuer();
    var MessageDigest = require_MessageDigest_browser();
    var Permuter = require_Permuter();
    var NQuads = require_NQuads();
    module.exports = class URDNA2015Sync {
      constructor({
        createMessageDigest = () => new MessageDigest("sha256"),
        canonicalIdMap = /* @__PURE__ */ new Map(),
        maxDeepIterations = Infinity
      } = {}) {
        this.name = "URDNA2015";
        this.blankNodeInfo = /* @__PURE__ */ new Map();
        this.canonicalIssuer = new IdentifierIssuer("_:c14n", canonicalIdMap);
        this.createMessageDigest = createMessageDigest;
        this.maxDeepIterations = maxDeepIterations;
        this.quads = null;
        this.deepIterations = null;
      }
      // 4.4) Normalization Algorithm
      main(dataset2) {
        this.deepIterations = /* @__PURE__ */ new Map();
        this.quads = dataset2;
        for (const quad3 of dataset2) {
          this._addBlankNodeQuadInfo({ quad: quad3, component: quad3.subject });
          this._addBlankNodeQuadInfo({ quad: quad3, component: quad3.object });
          this._addBlankNodeQuadInfo({ quad: quad3, component: quad3.graph });
        }
        const hashToBlankNodes = /* @__PURE__ */ new Map();
        const nonNormalized = [...this.blankNodeInfo.keys()];
        for (const id of nonNormalized) {
          this._hashAndTrackBlankNode({ id, hashToBlankNodes });
        }
        const hashes = [...hashToBlankNodes.keys()].sort();
        const nonUnique = [];
        for (const hash of hashes) {
          const idList = hashToBlankNodes.get(hash);
          if (idList.length > 1) {
            nonUnique.push(idList);
            continue;
          }
          const id = idList[0];
          this.canonicalIssuer.getId(id);
        }
        for (const idList of nonUnique) {
          const hashPathList = [];
          for (const id of idList) {
            if (this.canonicalIssuer.hasId(id)) {
              continue;
            }
            const issuer = new IdentifierIssuer("_:b");
            issuer.getId(id);
            const result = this.hashNDegreeQuads(id, issuer);
            hashPathList.push(result);
          }
          hashPathList.sort(_stringHashCompare);
          for (const result of hashPathList) {
            const oldIds = result.issuer.getOldIds();
            for (const id of oldIds) {
              this.canonicalIssuer.getId(id);
            }
          }
        }
        const normalized = [];
        for (const quad3 of this.quads) {
          const nQuad = NQuads.serializeQuadComponents(
            this._componentWithCanonicalId({ component: quad3.subject }),
            quad3.predicate,
            this._componentWithCanonicalId({ component: quad3.object }),
            this._componentWithCanonicalId({ component: quad3.graph })
          );
          normalized.push(nQuad);
        }
        normalized.sort();
        return normalized.join("");
      }
      // 4.6) Hash First Degree Quads
      hashFirstDegreeQuads(id) {
        const nquads = [];
        const info = this.blankNodeInfo.get(id);
        const quads = info.quads;
        for (const quad3 of quads) {
          const copy = {
            subject: null,
            predicate: quad3.predicate,
            object: null,
            graph: null
          };
          copy.subject = this.modifyFirstDegreeComponent(
            id,
            quad3.subject,
            "subject"
          );
          copy.object = this.modifyFirstDegreeComponent(
            id,
            quad3.object,
            "object"
          );
          copy.graph = this.modifyFirstDegreeComponent(
            id,
            quad3.graph,
            "graph"
          );
          nquads.push(NQuads.serializeQuad(copy));
        }
        nquads.sort();
        const md = this.createMessageDigest();
        for (const nquad of nquads) {
          md.update(nquad);
        }
        info.hash = md.digest();
        return info.hash;
      }
      // 4.7) Hash Related Blank Node
      hashRelatedBlankNode(related, quad3, issuer, position) {
        let id;
        if (this.canonicalIssuer.hasId(related)) {
          id = this.canonicalIssuer.getId(related);
        } else if (issuer.hasId(related)) {
          id = issuer.getId(related);
        } else {
          id = this.blankNodeInfo.get(related).hash;
        }
        const md = this.createMessageDigest();
        md.update(position);
        if (position !== "g") {
          md.update(this.getRelatedPredicate(quad3));
        }
        md.update(id);
        return md.digest();
      }
      // 4.8) Hash N-Degree Quads
      hashNDegreeQuads(id, issuer) {
        const deepIterations = this.deepIterations.get(id) || 0;
        if (deepIterations > this.maxDeepIterations) {
          throw new Error(
            `Maximum deep iterations (${this.maxDeepIterations}) exceeded.`
          );
        }
        this.deepIterations.set(id, deepIterations + 1);
        const md = this.createMessageDigest();
        const hashToRelated = this.createHashToRelated(id, issuer);
        const hashes = [...hashToRelated.keys()].sort();
        for (const hash of hashes) {
          md.update(hash);
          let chosenPath = "";
          let chosenIssuer;
          const permuter = new Permuter(hashToRelated.get(hash));
          while (permuter.hasNext()) {
            const permutation = permuter.next();
            let issuerCopy = issuer.clone();
            let path = "";
            const recursionList = [];
            let nextPermutation = false;
            for (const related of permutation) {
              if (this.canonicalIssuer.hasId(related)) {
                path += this.canonicalIssuer.getId(related);
              } else {
                if (!issuerCopy.hasId(related)) {
                  recursionList.push(related);
                }
                path += issuerCopy.getId(related);
              }
              if (chosenPath.length !== 0 && path > chosenPath) {
                nextPermutation = true;
                break;
              }
            }
            if (nextPermutation) {
              continue;
            }
            for (const related of recursionList) {
              const result = this.hashNDegreeQuads(related, issuerCopy);
              path += issuerCopy.getId(related);
              path += `<${result.hash}>`;
              issuerCopy = result.issuer;
              if (chosenPath.length !== 0 && path > chosenPath) {
                nextPermutation = true;
                break;
              }
            }
            if (nextPermutation) {
              continue;
            }
            if (chosenPath.length === 0 || path < chosenPath) {
              chosenPath = path;
              chosenIssuer = issuerCopy;
            }
          }
          md.update(chosenPath);
          issuer = chosenIssuer;
        }
        return { hash: md.digest(), issuer };
      }
      // helper for modifying component during Hash First Degree Quads
      modifyFirstDegreeComponent(id, component) {
        if (component.termType !== "BlankNode") {
          return component;
        }
        return {
          termType: "BlankNode",
          value: component.value === id ? "_:a" : "_:z"
        };
      }
      // helper for getting a related predicate
      getRelatedPredicate(quad3) {
        return `<${quad3.predicate.value}>`;
      }
      // helper for creating hash to related blank nodes map
      createHashToRelated(id, issuer) {
        const hashToRelated = /* @__PURE__ */ new Map();
        const quads = this.blankNodeInfo.get(id).quads;
        for (const quad3 of quads) {
          this._addRelatedBlankNodeHash({
            quad: quad3,
            component: quad3.subject,
            position: "s",
            id,
            issuer,
            hashToRelated
          });
          this._addRelatedBlankNodeHash({
            quad: quad3,
            component: quad3.object,
            position: "o",
            id,
            issuer,
            hashToRelated
          });
          this._addRelatedBlankNodeHash({
            quad: quad3,
            component: quad3.graph,
            position: "g",
            id,
            issuer,
            hashToRelated
          });
        }
        return hashToRelated;
      }
      _hashAndTrackBlankNode({ id, hashToBlankNodes }) {
        const hash = this.hashFirstDegreeQuads(id);
        const idList = hashToBlankNodes.get(hash);
        if (!idList) {
          hashToBlankNodes.set(hash, [id]);
        } else {
          idList.push(id);
        }
      }
      _addBlankNodeQuadInfo({ quad: quad3, component }) {
        if (component.termType !== "BlankNode") {
          return;
        }
        const id = component.value;
        const info = this.blankNodeInfo.get(id);
        if (info) {
          info.quads.add(quad3);
        } else {
          this.blankNodeInfo.set(id, { quads: /* @__PURE__ */ new Set([quad3]), hash: null });
        }
      }
      _addRelatedBlankNodeHash({ quad: quad3, component, position, id, issuer, hashToRelated }) {
        if (!(component.termType === "BlankNode" && component.value !== id)) {
          return;
        }
        const related = component.value;
        const hash = this.hashRelatedBlankNode(related, quad3, issuer, position);
        const entries2 = hashToRelated.get(hash);
        if (entries2) {
          entries2.push(related);
        } else {
          hashToRelated.set(hash, [related]);
        }
      }
      // canonical ids for 7.1
      _componentWithCanonicalId({ component }) {
        if (component.termType === "BlankNode" && !component.value.startsWith(this.canonicalIssuer.prefix)) {
          return {
            termType: "BlankNode",
            value: this.canonicalIssuer.getId(component.value)
          };
        }
        return component;
      }
    };
    function _stringHashCompare(a2, b) {
      return a2.hash < b.hash ? -1 : a2.hash > b.hash ? 1 : 0;
    }
  }
});

// node_modules/rdf-dataset-ext/toCanonical.js
var require_toCanonical = __commonJS({
  "node_modules/rdf-dataset-ext/toCanonical.js"(exports, module) {
    var URDNA2015Sync = require_URDNA2015Sync();
    function toCanonical4(dataset2) {
      return new URDNA2015Sync().main(dataset2);
    }
    module.exports = toCanonical4;
  }
});

// node_modules/rdf-dataset-ext/addAll.js
var require_addAll = __commonJS({
  "node_modules/rdf-dataset-ext/addAll.js"(exports, module) {
    function addAll4(dataset2, quads) {
      for (const quad3 of quads) {
        dataset2.add(quad3);
      }
      return dataset2;
    }
    module.exports = addAll4;
  }
});

// node_modules/rdf-dataset-ext/deleteMatch.js
var require_deleteMatch = __commonJS({
  "node_modules/rdf-dataset-ext/deleteMatch.js"(exports, module) {
    function deleteMatch3(dataset2, subject, predicate, object, graph) {
      const matches = dataset2.match(subject, predicate, object, graph);
      for (const quad3 of matches) {
        dataset2.delete(quad3);
      }
      return dataset2;
    }
    module.exports = deleteMatch3;
  }
});

// node_modules/rdf-dataset-ext/equals.js
var require_equals = __commonJS({
  "node_modules/rdf-dataset-ext/equals.js"(exports, module) {
    function equals3(a2, b) {
      if (a2.size !== b.size) {
        return false;
      }
      for (const quad3 of a2) {
        if (!b.has(quad3)) {
          return false;
        }
      }
      return true;
    }
    module.exports = equals3;
  }
});

// node_modules/ms/index.js
var require_ms = __commonJS({
  "node_modules/ms/index.js"(exports, module) {
    var s = 1e3;
    var m = s * 60;
    var h2 = m * 60;
    var d = h2 * 24;
    var w = d * 7;
    var y = d * 365.25;
    module.exports = function(val, options) {
      options = options || {};
      var type = typeof val;
      if (type === "string" && val.length > 0) {
        return parse(val);
      } else if (type === "number" && isFinite(val)) {
        return options.long ? fmtLong(val) : fmtShort(val);
      }
      throw new Error(
        "val is not a non-empty string or a valid number. val=" + JSON.stringify(val)
      );
    };
    function parse(str) {
      str = String(str);
      if (str.length > 100) {
        return;
      }
      var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
        str
      );
      if (!match) {
        return;
      }
      var n2 = parseFloat(match[1]);
      var type = (match[2] || "ms").toLowerCase();
      switch (type) {
        case "years":
        case "year":
        case "yrs":
        case "yr":
        case "y":
          return n2 * y;
        case "weeks":
        case "week":
        case "w":
          return n2 * w;
        case "days":
        case "day":
        case "d":
          return n2 * d;
        case "hours":
        case "hour":
        case "hrs":
        case "hr":
        case "h":
          return n2 * h2;
        case "minutes":
        case "minute":
        case "mins":
        case "min":
        case "m":
          return n2 * m;
        case "seconds":
        case "second":
        case "secs":
        case "sec":
        case "s":
          return n2 * s;
        case "milliseconds":
        case "millisecond":
        case "msecs":
        case "msec":
        case "ms":
          return n2;
        default:
          return void 0;
      }
    }
    function fmtShort(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) {
        return Math.round(ms / d) + "d";
      }
      if (msAbs >= h2) {
        return Math.round(ms / h2) + "h";
      }
      if (msAbs >= m) {
        return Math.round(ms / m) + "m";
      }
      if (msAbs >= s) {
        return Math.round(ms / s) + "s";
      }
      return ms + "ms";
    }
    function fmtLong(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) {
        return plural(ms, msAbs, d, "day");
      }
      if (msAbs >= h2) {
        return plural(ms, msAbs, h2, "hour");
      }
      if (msAbs >= m) {
        return plural(ms, msAbs, m, "minute");
      }
      if (msAbs >= s) {
        return plural(ms, msAbs, s, "second");
      }
      return ms + " ms";
    }
    function plural(ms, msAbs, n2, name) {
      var isPlural = msAbs >= n2 * 1.5;
      return Math.round(ms / n2) + " " + name + (isPlural ? "s" : "");
    }
  }
});

// node_modules/debug/src/common.js
var require_common = __commonJS({
  "node_modules/debug/src/common.js"(exports, module) {
    function setup(env) {
      createDebug.debug = createDebug;
      createDebug.default = createDebug;
      createDebug.coerce = coerce;
      createDebug.disable = disable;
      createDebug.enable = enable;
      createDebug.enabled = enabled;
      createDebug.humanize = require_ms();
      createDebug.destroy = destroy;
      Object.keys(env).forEach((key) => {
        createDebug[key] = env[key];
      });
      createDebug.names = [];
      createDebug.skips = [];
      createDebug.formatters = {};
      function selectColor(namespace2) {
        let hash = 0;
        for (let i2 = 0; i2 < namespace2.length; i2++) {
          hash = (hash << 5) - hash + namespace2.charCodeAt(i2);
          hash |= 0;
        }
        return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
      }
      createDebug.selectColor = selectColor;
      function createDebug(namespace2) {
        let prevTime;
        let enableOverride = null;
        let namespacesCache;
        let enabledCache;
        function debug2(...args) {
          if (!debug2.enabled) {
            return;
          }
          const self2 = debug2;
          const curr = Number(/* @__PURE__ */ new Date());
          const ms = curr - (prevTime || curr);
          self2.diff = ms;
          self2.prev = prevTime;
          self2.curr = curr;
          prevTime = curr;
          args[0] = createDebug.coerce(args[0]);
          if (typeof args[0] !== "string") {
            args.unshift("%O");
          }
          let index = 0;
          args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
            if (match === "%%") {
              return "%";
            }
            index++;
            const formatter = createDebug.formatters[format];
            if (typeof formatter === "function") {
              const val = args[index];
              match = formatter.call(self2, val);
              args.splice(index, 1);
              index--;
            }
            return match;
          });
          createDebug.formatArgs.call(self2, args);
          const logFn = self2.log || createDebug.log;
          logFn.apply(self2, args);
        }
        debug2.namespace = namespace2;
        debug2.useColors = createDebug.useColors();
        debug2.color = createDebug.selectColor(namespace2);
        debug2.extend = extend2;
        debug2.destroy = createDebug.destroy;
        Object.defineProperty(debug2, "enabled", {
          enumerable: true,
          configurable: false,
          get: () => {
            if (enableOverride !== null) {
              return enableOverride;
            }
            if (namespacesCache !== createDebug.namespaces) {
              namespacesCache = createDebug.namespaces;
              enabledCache = createDebug.enabled(namespace2);
            }
            return enabledCache;
          },
          set: (v) => {
            enableOverride = v;
          }
        });
        if (typeof createDebug.init === "function") {
          createDebug.init(debug2);
        }
        return debug2;
      }
      function extend2(namespace2, delimiter) {
        const newDebug = createDebug(this.namespace + (typeof delimiter === "undefined" ? ":" : delimiter) + namespace2);
        newDebug.log = this.log;
        return newDebug;
      }
      function enable(namespaces) {
        createDebug.save(namespaces);
        createDebug.namespaces = namespaces;
        createDebug.names = [];
        createDebug.skips = [];
        const split = (typeof namespaces === "string" ? namespaces : "").trim().replace(/\s+/g, ",").split(",").filter(Boolean);
        for (const ns2 of split) {
          if (ns2[0] === "-") {
            createDebug.skips.push(ns2.slice(1));
          } else {
            createDebug.names.push(ns2);
          }
        }
      }
      function matchesTemplate(search, template) {
        let searchIndex = 0;
        let templateIndex = 0;
        let starIndex = -1;
        let matchIndex = 0;
        while (searchIndex < search.length) {
          if (templateIndex < template.length && (template[templateIndex] === search[searchIndex] || template[templateIndex] === "*")) {
            if (template[templateIndex] === "*") {
              starIndex = templateIndex;
              matchIndex = searchIndex;
              templateIndex++;
            } else {
              searchIndex++;
              templateIndex++;
            }
          } else if (starIndex !== -1) {
            templateIndex = starIndex + 1;
            matchIndex++;
            searchIndex = matchIndex;
          } else {
            return false;
          }
        }
        while (templateIndex < template.length && template[templateIndex] === "*") {
          templateIndex++;
        }
        return templateIndex === template.length;
      }
      function disable() {
        const namespaces = [
          ...createDebug.names,
          ...createDebug.skips.map((namespace2) => "-" + namespace2)
        ].join(",");
        createDebug.enable("");
        return namespaces;
      }
      function enabled(name) {
        for (const skip of createDebug.skips) {
          if (matchesTemplate(name, skip)) {
            return false;
          }
        }
        for (const ns2 of createDebug.names) {
          if (matchesTemplate(name, ns2)) {
            return true;
          }
        }
        return false;
      }
      function coerce(val) {
        if (val instanceof Error) {
          return val.stack || val.message;
        }
        return val;
      }
      function destroy() {
        console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
      }
      createDebug.enable(createDebug.load());
      return createDebug;
    }
    module.exports = setup;
  }
});

// node_modules/debug/src/browser.js
var require_browser4 = __commonJS({
  "node_modules/debug/src/browser.js"(exports, module) {
    exports.formatArgs = formatArgs;
    exports.save = save;
    exports.load = load;
    exports.useColors = useColors;
    exports.storage = localstorage();
    exports.destroy = /* @__PURE__ */ (() => {
      let warned = false;
      return () => {
        if (!warned) {
          warned = true;
          console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
        }
      };
    })();
    exports.colors = [
      "#0000CC",
      "#0000FF",
      "#0033CC",
      "#0033FF",
      "#0066CC",
      "#0066FF",
      "#0099CC",
      "#0099FF",
      "#00CC00",
      "#00CC33",
      "#00CC66",
      "#00CC99",
      "#00CCCC",
      "#00CCFF",
      "#3300CC",
      "#3300FF",
      "#3333CC",
      "#3333FF",
      "#3366CC",
      "#3366FF",
      "#3399CC",
      "#3399FF",
      "#33CC00",
      "#33CC33",
      "#33CC66",
      "#33CC99",
      "#33CCCC",
      "#33CCFF",
      "#6600CC",
      "#6600FF",
      "#6633CC",
      "#6633FF",
      "#66CC00",
      "#66CC33",
      "#9900CC",
      "#9900FF",
      "#9933CC",
      "#9933FF",
      "#99CC00",
      "#99CC33",
      "#CC0000",
      "#CC0033",
      "#CC0066",
      "#CC0099",
      "#CC00CC",
      "#CC00FF",
      "#CC3300",
      "#CC3333",
      "#CC3366",
      "#CC3399",
      "#CC33CC",
      "#CC33FF",
      "#CC6600",
      "#CC6633",
      "#CC9900",
      "#CC9933",
      "#CCCC00",
      "#CCCC33",
      "#FF0000",
      "#FF0033",
      "#FF0066",
      "#FF0099",
      "#FF00CC",
      "#FF00FF",
      "#FF3300",
      "#FF3333",
      "#FF3366",
      "#FF3399",
      "#FF33CC",
      "#FF33FF",
      "#FF6600",
      "#FF6633",
      "#FF9900",
      "#FF9933",
      "#FFCC00",
      "#FFCC33"
    ];
    function useColors() {
      if (typeof window !== "undefined" && window.process && (window.process.type === "renderer" || window.process.__nwjs)) {
        return true;
      }
      if (typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
        return false;
      }
      let m;
      return typeof document !== "undefined" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || // Is firebug? http://stackoverflow.com/a/398120/376773
      typeof window !== "undefined" && window.console && (window.console.firebug || window.console.exception && window.console.table) || // Is firefox >= v31?
      // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
      typeof navigator !== "undefined" && navigator.userAgent && (m = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(m[1], 10) >= 31 || // Double check webkit in userAgent just in case we are in a worker
      typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
    }
    function formatArgs(args) {
      args[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + args[0] + (this.useColors ? "%c " : " ") + "+" + module.exports.humanize(this.diff);
      if (!this.useColors) {
        return;
      }
      const c3 = "color: " + this.color;
      args.splice(1, 0, c3, "color: inherit");
      let index = 0;
      let lastC = 0;
      args[0].replace(/%[a-zA-Z%]/g, (match) => {
        if (match === "%%") {
          return;
        }
        index++;
        if (match === "%c") {
          lastC = index;
        }
      });
      args.splice(lastC, 0, c3);
    }
    exports.log = console.debug || console.log || (() => {
    });
    function save(namespaces) {
      try {
        if (namespaces) {
          exports.storage.setItem("debug", namespaces);
        } else {
          exports.storage.removeItem("debug");
        }
      } catch (error2) {
      }
    }
    function load() {
      let r;
      try {
        r = exports.storage.getItem("debug") || exports.storage.getItem("DEBUG");
      } catch (error2) {
      }
      if (!r && typeof process !== "undefined" && "env" in process) {
        r = process.env.DEBUG;
      }
      return r;
    }
    function localstorage() {
      try {
        return localStorage;
      } catch (error2) {
      }
    }
    module.exports = require_common()(exports);
    var { formatters } = module.exports;
    formatters.j = function(v) {
      try {
        return JSON.stringify(v);
      } catch (error2) {
        return "[UnexpectedJSONParseError]: " + error2.message;
      }
    };
  }
});

// node_modules/rdf-data-factory/lib/BlankNode.js
var require_BlankNode = __commonJS({
  "node_modules/rdf-data-factory/lib/BlankNode.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.BlankNode = void 0;
    var BlankNode3 = class {
      constructor(value) {
        this.termType = "BlankNode";
        this.value = value;
      }
      equals(other) {
        return !!other && other.termType === "BlankNode" && other.value === this.value;
      }
    };
    exports.BlankNode = BlankNode3;
  }
});

// node_modules/rdf-data-factory/lib/DefaultGraph.js
var require_DefaultGraph = __commonJS({
  "node_modules/rdf-data-factory/lib/DefaultGraph.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DefaultGraph = void 0;
    var DefaultGraph3 = class {
      constructor() {
        this.termType = "DefaultGraph";
        this.value = "";
      }
      equals(other) {
        return !!other && other.termType === "DefaultGraph";
      }
    };
    exports.DefaultGraph = DefaultGraph3;
    DefaultGraph3.INSTANCE = new DefaultGraph3();
  }
});

// node_modules/rdf-data-factory/lib/NamedNode.js
var require_NamedNode = __commonJS({
  "node_modules/rdf-data-factory/lib/NamedNode.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NamedNode = void 0;
    var NamedNode3 = class {
      constructor(value) {
        this.termType = "NamedNode";
        this.value = value;
      }
      equals(other) {
        return !!other && other.termType === "NamedNode" && other.value === this.value;
      }
    };
    exports.NamedNode = NamedNode3;
  }
});

// node_modules/rdf-data-factory/lib/Literal.js
var require_Literal = __commonJS({
  "node_modules/rdf-data-factory/lib/Literal.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Literal = void 0;
    var NamedNode_1 = require_NamedNode();
    var Literal3 = class _Literal {
      constructor(value, languageOrDatatype) {
        this.termType = "Literal";
        this.value = value;
        if (typeof languageOrDatatype === "string") {
          this.language = languageOrDatatype;
          this.datatype = _Literal.RDF_LANGUAGE_STRING;
          this.direction = "";
        } else if (languageOrDatatype) {
          if ("termType" in languageOrDatatype) {
            this.language = "";
            this.datatype = languageOrDatatype;
            this.direction = "";
          } else {
            this.language = languageOrDatatype.language;
            this.datatype = languageOrDatatype.direction ? _Literal.RDF_DIRECTIONAL_LANGUAGE_STRING : _Literal.RDF_LANGUAGE_STRING;
            this.direction = languageOrDatatype.direction || "";
          }
        } else {
          this.language = "";
          this.datatype = _Literal.XSD_STRING;
          this.direction = "";
        }
      }
      equals(other) {
        return !!other && other.termType === "Literal" && other.value === this.value && other.language === this.language && (other.direction === this.direction || !other.direction && this.direction === "") && this.datatype.equals(other.datatype);
      }
    };
    exports.Literal = Literal3;
    Literal3.RDF_LANGUAGE_STRING = new NamedNode_1.NamedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#langString");
    Literal3.RDF_DIRECTIONAL_LANGUAGE_STRING = new NamedNode_1.NamedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString");
    Literal3.XSD_STRING = new NamedNode_1.NamedNode("http://www.w3.org/2001/XMLSchema#string");
  }
});

// node_modules/rdf-data-factory/lib/Quad.js
var require_Quad = __commonJS({
  "node_modules/rdf-data-factory/lib/Quad.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Quad = void 0;
    var Quad3 = class {
      constructor(subject, predicate, object, graph) {
        this.termType = "Quad";
        this.value = "";
        this.subject = subject;
        this.predicate = predicate;
        this.object = object;
        this.graph = graph;
      }
      equals(other) {
        return !!other && (other.termType === "Quad" || !other.termType) && this.subject.equals(other.subject) && this.predicate.equals(other.predicate) && this.object.equals(other.object) && this.graph.equals(other.graph);
      }
    };
    exports.Quad = Quad3;
  }
});

// node_modules/rdf-data-factory/lib/Variable.js
var require_Variable = __commonJS({
  "node_modules/rdf-data-factory/lib/Variable.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Variable = void 0;
    var Variable3 = class {
      constructor(value) {
        this.termType = "Variable";
        this.value = value;
      }
      equals(other) {
        return !!other && other.termType === "Variable" && other.value === this.value;
      }
    };
    exports.Variable = Variable3;
  }
});

// node_modules/rdf-data-factory/lib/DataFactory.js
var require_DataFactory = __commonJS({
  "node_modules/rdf-data-factory/lib/DataFactory.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DataFactory = void 0;
    var BlankNode_1 = require_BlankNode();
    var DefaultGraph_1 = require_DefaultGraph();
    var Literal_1 = require_Literal();
    var NamedNode_1 = require_NamedNode();
    var Quad_1 = require_Quad();
    var Variable_1 = require_Variable();
    var dataFactoryCounter = 0;
    var DataFactory3 = class {
      constructor(options) {
        this.blankNodeCounter = 0;
        options = options || {};
        this.blankNodePrefix = options.blankNodePrefix || `df_${dataFactoryCounter++}_`;
      }
      /**
       * @param value The IRI for the named node.
       * @return A new instance of NamedNode.
       * @see NamedNode
       */
      namedNode(value) {
        return new NamedNode_1.NamedNode(value);
      }
      /**
       * @param value The optional blank node identifier.
       * @return A new instance of BlankNode.
       *         If the `value` parameter is undefined a new identifier
       *         for the blank node is generated for each call.
       * @see BlankNode
       */
      blankNode(value) {
        return new BlankNode_1.BlankNode(value || `${this.blankNodePrefix}${this.blankNodeCounter++}`);
      }
      /**
       * @param value              The literal value.
       * @param languageOrDatatype The optional language, datatype, or directional language.
       *                           If `languageOrDatatype` is a NamedNode,
       *                           then it is used for the value of `NamedNode.datatype`.
       *                           If `languageOrDatatype` is a NamedNode, it is used for the value
       *                           of `NamedNode.language`.
       *                           Otherwise, it is used as a directional language,
       *                           from which the language is set to `languageOrDatatype.language`
       *                           and the direction to `languageOrDatatype.direction`.
       * @return A new instance of Literal.
       * @see Literal
       */
      literal(value, languageOrDatatype) {
        return new Literal_1.Literal(value, languageOrDatatype);
      }
      /**
       * This method is optional.
       * @param value The variable name
       * @return A new instance of Variable.
       * @see Variable
       */
      variable(value) {
        return new Variable_1.Variable(value);
      }
      /**
       * @return An instance of DefaultGraph.
       */
      defaultGraph() {
        return DefaultGraph_1.DefaultGraph.INSTANCE;
      }
      /**
       * @param subject   The quad subject term.
       * @param predicate The quad predicate term.
       * @param object    The quad object term.
       * @param graph     The quad graph term.
       * @return A new instance of Quad.
       * @see Quad
       */
      quad(subject, predicate, object, graph) {
        return new Quad_1.Quad(subject, predicate, object, graph || this.defaultGraph());
      }
      /**
       * Create a deep copy of the given term using this data factory.
       * @param original An RDF term.
       * @return A deep copy of the given term.
       */
      fromTerm(original) {
        switch (original.termType) {
          case "NamedNode":
            return this.namedNode(original.value);
          case "BlankNode":
            return this.blankNode(original.value);
          case "Literal":
            if (original.language) {
              return this.literal(original.value, original.language);
            }
            if (!original.datatype.equals(Literal_1.Literal.XSD_STRING)) {
              return this.literal(original.value, this.fromTerm(original.datatype));
            }
            return this.literal(original.value);
          case "Variable":
            return this.variable(original.value);
          case "DefaultGraph":
            return this.defaultGraph();
          case "Quad":
            return this.quad(this.fromTerm(original.subject), this.fromTerm(original.predicate), this.fromTerm(original.object), this.fromTerm(original.graph));
        }
      }
      /**
       * Create a deep copy of the given quad using this data factory.
       * @param original An RDF quad.
       * @return A deep copy of the given quad.
       */
      fromQuad(original) {
        return this.fromTerm(original);
      }
      /**
       * Reset the internal blank node counter.
       */
      resetBlankNodeCounter() {
        this.blankNodeCounter = 0;
      }
    };
    exports.DataFactory = DataFactory3;
  }
});

// node_modules/rdf-data-factory/index.js
var require_rdf_data_factory = __commonJS({
  "node_modules/rdf-data-factory/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o2, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o2, k2, desc);
    }) : (function(o2, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o2[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_BlankNode(), exports);
    __exportStar(require_DataFactory(), exports);
    __exportStar(require_DefaultGraph(), exports);
    __exportStar(require_Literal(), exports);
    __exportStar(require_NamedNode(), exports);
    __exportStar(require_Quad(), exports);
    __exportStar(require_Variable(), exports);
  }
});

// node_modules/rdf-literal/lib/Translator.js
var require_Translator = __commonJS({
  "node_modules/rdf-literal/lib/Translator.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Translator = void 0;
    var Translator = class {
      constructor() {
        this.supportedRdfDatatypes = [];
        this.fromRdfHandlers = {};
        this.toRdfHandlers = {};
      }
      static incorrectRdfDataType(literal4) {
        throw new Error(`Invalid RDF ${literal4.datatype.value} value: '${literal4.value}'`);
      }
      registerHandler(handler2, rdfDatatypes, javaScriptDataTypes) {
        for (const rdfDatatype of rdfDatatypes) {
          this.supportedRdfDatatypes.push(rdfDatatype);
          this.fromRdfHandlers[rdfDatatype.value] = handler2;
        }
        for (const javaScriptDataType of javaScriptDataTypes) {
          let existingToRdfHandlers = this.toRdfHandlers[javaScriptDataType];
          if (!existingToRdfHandlers) {
            this.toRdfHandlers[javaScriptDataType] = existingToRdfHandlers = [];
          }
          existingToRdfHandlers.push(handler2);
        }
      }
      fromRdf(literal4, validate) {
        const handler2 = this.fromRdfHandlers[literal4.datatype.value];
        if (handler2) {
          return handler2.fromRdf(literal4, validate);
        } else {
          return literal4.value;
        }
      }
      toRdf(value, options) {
        const handlers = this.toRdfHandlers[typeof value];
        if (handlers) {
          for (const handler2 of handlers) {
            const ret = handler2.toRdf(value, options);
            if (ret) {
              return ret;
            }
          }
        }
        throw new Error(`Invalid JavaScript value: '${value}'`);
      }
      /**
       * @return {NamedNode[]} An array of all supported RDF datatypes.
       */
      getSupportedRdfDatatypes() {
        return this.supportedRdfDatatypes;
      }
      /**
       * @return {string[]} An array of all supported JavaScript types.
       */
      getSupportedJavaScriptPrimitives() {
        return Object.keys(this.toRdfHandlers);
      }
    };
    exports.Translator = Translator;
  }
});

// node_modules/rdf-literal/lib/handler/TypeHandlerBoolean.js
var require_TypeHandlerBoolean = __commonJS({
  "node_modules/rdf-literal/lib/handler/TypeHandlerBoolean.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TypeHandlerBoolean = void 0;
    var Translator_1 = require_Translator();
    var TypeHandlerBoolean = class _TypeHandlerBoolean {
      fromRdf(literal4, validate) {
        switch (literal4.value) {
          case "true":
            return true;
          case "false":
            return false;
          case "1":
            return true;
          case "0":
            return false;
        }
        if (validate) {
          Translator_1.Translator.incorrectRdfDataType(literal4);
        }
        return false;
      }
      toRdf(value, { datatype, dataFactory }) {
        return dataFactory.literal(value ? "true" : "false", datatype || dataFactory.namedNode(_TypeHandlerBoolean.TYPE));
      }
    };
    exports.TypeHandlerBoolean = TypeHandlerBoolean;
    TypeHandlerBoolean.TYPE = "http://www.w3.org/2001/XMLSchema#boolean";
  }
});

// node_modules/rdf-literal/lib/handler/TypeHandlerDate.js
var require_TypeHandlerDate = __commonJS({
  "node_modules/rdf-literal/lib/handler/TypeHandlerDate.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TypeHandlerDate = void 0;
    var Translator_1 = require_Translator();
    var TypeHandlerDate = class _TypeHandlerDate {
      fromRdf(literal4, validate) {
        if (validate && !literal4.value.match(_TypeHandlerDate.VALIDATORS[literal4.datatype.value.substr(33, literal4.datatype.value.length)])) {
          Translator_1.Translator.incorrectRdfDataType(literal4);
        }
        switch (literal4.datatype.value) {
          case "http://www.w3.org/2001/XMLSchema#gDay":
            return new Date(0, 0, parseInt(literal4.value, 10));
          case "http://www.w3.org/2001/XMLSchema#gMonthDay":
            const partsMonthDay = literal4.value.split("-");
            return new Date(0, parseInt(partsMonthDay[0], 10) - 1, parseInt(partsMonthDay[1], 10));
          case "http://www.w3.org/2001/XMLSchema#gYear":
            return /* @__PURE__ */ new Date(literal4.value + "-01-01");
          case "http://www.w3.org/2001/XMLSchema#gYearMonth":
            return /* @__PURE__ */ new Date(literal4.value + "-01");
          default:
            return new Date(literal4.value);
        }
      }
      toRdf(value, { datatype, dataFactory }) {
        datatype = datatype || dataFactory.namedNode(_TypeHandlerDate.TYPES[0]);
        if (!(value instanceof Date)) {
          return null;
        }
        const date = value;
        let valueString;
        switch (datatype.value) {
          case "http://www.w3.org/2001/XMLSchema#gDay":
            valueString = String(date.getUTCDate());
            break;
          case "http://www.w3.org/2001/XMLSchema#gMonthDay":
            valueString = date.getUTCMonth() + 1 + "-" + date.getUTCDate();
            break;
          case "http://www.w3.org/2001/XMLSchema#gYear":
            valueString = String(date.getUTCFullYear());
            break;
          case "http://www.w3.org/2001/XMLSchema#gYearMonth":
            valueString = date.getUTCFullYear() + "-" + (date.getUTCMonth() + 1);
            break;
          case "http://www.w3.org/2001/XMLSchema#date":
            valueString = date.toISOString().replace(/T.*$/, "");
            break;
          default:
            valueString = date.toISOString();
        }
        return dataFactory.literal(valueString, datatype);
      }
    };
    exports.TypeHandlerDate = TypeHandlerDate;
    TypeHandlerDate.TYPES = [
      "http://www.w3.org/2001/XMLSchema#dateTime",
      "http://www.w3.org/2001/XMLSchema#date",
      "http://www.w3.org/2001/XMLSchema#gDay",
      "http://www.w3.org/2001/XMLSchema#gMonthDay",
      "http://www.w3.org/2001/XMLSchema#gYear",
      "http://www.w3.org/2001/XMLSchema#gYearMonth"
    ];
    TypeHandlerDate.VALIDATORS = {
      date: /^[0-9]+-[0-9][0-9]-[0-9][0-9]Z?$/,
      dateTime: /^[0-9]+-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9](\.[0-9][0-9][0-9])?((Z?)|([\+-][0-9][0-9]:[0-9][0-9]))$/,
      gDay: /^[0-9]+$/,
      gMonthDay: /^[0-9]+-[0-9][0-9]$/,
      gYear: /^[0-9]+$/,
      gYearMonth: /^[0-9]+-[0-9][0-9]$/
    };
  }
});

// node_modules/rdf-literal/lib/handler/TypeHandlerNumberDouble.js
var require_TypeHandlerNumberDouble = __commonJS({
  "node_modules/rdf-literal/lib/handler/TypeHandlerNumberDouble.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TypeHandlerNumberDouble = void 0;
    var Translator_1 = require_Translator();
    var TypeHandlerNumberDouble = class _TypeHandlerNumberDouble {
      fromRdf(literal4, validate) {
        const parsed = parseFloat(literal4.value);
        if (validate) {
          if (isNaN(parsed)) {
            Translator_1.Translator.incorrectRdfDataType(literal4);
          }
        }
        return parsed;
      }
      toRdf(value, { datatype, dataFactory }) {
        datatype = datatype || dataFactory.namedNode(_TypeHandlerNumberDouble.TYPES[0]);
        if (isNaN(value)) {
          return dataFactory.literal("NaN", datatype);
        }
        if (!isFinite(value)) {
          return dataFactory.literal(value > 0 ? "INF" : "-INF", datatype);
        }
        if (value % 1 === 0) {
          return null;
        }
        return dataFactory.literal(value.toExponential(15).replace(/(\d)0*e\+?/, "$1E"), datatype);
      }
    };
    exports.TypeHandlerNumberDouble = TypeHandlerNumberDouble;
    TypeHandlerNumberDouble.TYPES = [
      "http://www.w3.org/2001/XMLSchema#double",
      "http://www.w3.org/2001/XMLSchema#decimal",
      "http://www.w3.org/2001/XMLSchema#float"
    ];
  }
});

// node_modules/rdf-literal/lib/handler/TypeHandlerNumberInteger.js
var require_TypeHandlerNumberInteger = __commonJS({
  "node_modules/rdf-literal/lib/handler/TypeHandlerNumberInteger.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TypeHandlerNumberInteger = void 0;
    var Translator_1 = require_Translator();
    var TypeHandlerNumberInteger = class _TypeHandlerNumberInteger {
      fromRdf(literal4, validate) {
        const parsed = parseInt(literal4.value, 10);
        if (validate) {
          if (isNaN(parsed) || literal4.value.indexOf(".") >= 0) {
            Translator_1.Translator.incorrectRdfDataType(literal4);
          }
        }
        return parsed;
      }
      toRdf(value, { datatype, dataFactory }) {
        return dataFactory.literal(String(value), datatype || (value <= _TypeHandlerNumberInteger.MAX_INT && value >= _TypeHandlerNumberInteger.MIN_INT ? dataFactory.namedNode(_TypeHandlerNumberInteger.TYPES[0]) : dataFactory.namedNode(_TypeHandlerNumberInteger.TYPES[1])));
      }
    };
    exports.TypeHandlerNumberInteger = TypeHandlerNumberInteger;
    TypeHandlerNumberInteger.TYPES = [
      "http://www.w3.org/2001/XMLSchema#integer",
      "http://www.w3.org/2001/XMLSchema#long",
      "http://www.w3.org/2001/XMLSchema#int",
      "http://www.w3.org/2001/XMLSchema#byte",
      "http://www.w3.org/2001/XMLSchema#short",
      "http://www.w3.org/2001/XMLSchema#negativeInteger",
      "http://www.w3.org/2001/XMLSchema#nonNegativeInteger",
      "http://www.w3.org/2001/XMLSchema#nonPositiveInteger",
      "http://www.w3.org/2001/XMLSchema#positiveInteger",
      "http://www.w3.org/2001/XMLSchema#unsignedByte",
      "http://www.w3.org/2001/XMLSchema#unsignedInt",
      "http://www.w3.org/2001/XMLSchema#unsignedLong",
      "http://www.w3.org/2001/XMLSchema#unsignedShort"
    ];
    TypeHandlerNumberInteger.MAX_INT = 2147483647;
    TypeHandlerNumberInteger.MIN_INT = -2147483648;
  }
});

// node_modules/rdf-literal/lib/handler/TypeHandlerString.js
var require_TypeHandlerString = __commonJS({
  "node_modules/rdf-literal/lib/handler/TypeHandlerString.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TypeHandlerString = void 0;
    var TypeHandlerString = class {
      fromRdf(literal4) {
        return literal4.value;
      }
      toRdf(value, { datatype, dataFactory }) {
        return dataFactory.literal(value, datatype);
      }
    };
    exports.TypeHandlerString = TypeHandlerString;
    TypeHandlerString.TYPES = [
      "http://www.w3.org/2001/XMLSchema#string",
      "http://www.w3.org/2001/XMLSchema#normalizedString",
      "http://www.w3.org/2001/XMLSchema#anyURI",
      "http://www.w3.org/2001/XMLSchema#base64Binary",
      "http://www.w3.org/2001/XMLSchema#language",
      "http://www.w3.org/2001/XMLSchema#Name",
      "http://www.w3.org/2001/XMLSchema#NCName",
      "http://www.w3.org/2001/XMLSchema#NMTOKEN",
      "http://www.w3.org/2001/XMLSchema#token",
      "http://www.w3.org/2001/XMLSchema#hexBinary",
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString",
      "http://www.w3.org/2001/XMLSchema#time",
      "http://www.w3.org/2001/XMLSchema#duration"
    ];
  }
});

// node_modules/rdf-literal/lib/handler/index.js
var require_handler = __commonJS({
  "node_modules/rdf-literal/lib/handler/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o2, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o2, k2, desc);
    }) : (function(o2, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o2[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_TypeHandlerBoolean(), exports);
    __exportStar(require_TypeHandlerDate(), exports);
    __exportStar(require_TypeHandlerNumberDouble(), exports);
    __exportStar(require_TypeHandlerNumberInteger(), exports);
    __exportStar(require_TypeHandlerString(), exports);
  }
});

// node_modules/rdf-literal/lib/ITypeHandler.js
var require_ITypeHandler = __commonJS({
  "node_modules/rdf-literal/lib/ITypeHandler.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
  }
});

// node_modules/rdf-literal/index.js
var require_rdf_literal = __commonJS({
  "node_modules/rdf-literal/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o2, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o2, k2, desc);
    }) : (function(o2, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o2[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.fromRdf = fromRdf2;
    exports.toRdf = toRdf;
    exports.getTermRaw = getTermRaw;
    exports.getSupportedRdfDatatypes = getSupportedRdfDatatypes;
    exports.getSupportedJavaScriptPrimitives = getSupportedJavaScriptPrimitives;
    var rdf_data_factory_1 = require_rdf_data_factory();
    var handler_1 = require_handler();
    var Translator_1 = require_Translator();
    __exportStar(require_handler(), exports);
    __exportStar(require_ITypeHandler(), exports);
    __exportStar(require_Translator(), exports);
    var DF = new rdf_data_factory_1.DataFactory();
    var translator = new Translator_1.Translator();
    translator.registerHandler(new handler_1.TypeHandlerString(), handler_1.TypeHandlerString.TYPES.map((t) => DF.namedNode(t)), ["string"]);
    translator.registerHandler(new handler_1.TypeHandlerBoolean(), [handler_1.TypeHandlerBoolean.TYPE].map((t) => DF.namedNode(t)), ["boolean"]);
    translator.registerHandler(new handler_1.TypeHandlerNumberDouble(), handler_1.TypeHandlerNumberDouble.TYPES.map((t) => DF.namedNode(t)), ["number"]);
    translator.registerHandler(new handler_1.TypeHandlerNumberInteger(), handler_1.TypeHandlerNumberInteger.TYPES.map((t) => DF.namedNode(t)), ["number"]);
    translator.registerHandler(new handler_1.TypeHandlerDate(), handler_1.TypeHandlerDate.TYPES.map((t) => DF.namedNode(t)), ["object"]);
    function fromRdf2(literal4, validate) {
      return translator.fromRdf(literal4, validate);
    }
    function toRdf(value, options) {
      if (options && "namedNode" in options) {
        options = { dataFactory: options };
      }
      options = options || {};
      if (options && !options.dataFactory) {
        options.dataFactory = DF;
      }
      return translator.toRdf(value, options);
    }
    function getTermRaw(term2, validate) {
      if (term2.termType === "Literal") {
        return fromRdf2(term2, validate);
      }
      return term2.value;
    }
    function getSupportedRdfDatatypes() {
      return translator.getSupportedRdfDatatypes();
    }
    function getSupportedJavaScriptPrimitives() {
      return translator.getSupportedJavaScriptPrimitives();
    }
  }
});

// node_modules/@rdfjs/environment/Environment.js
var Environment = class _Environment {
  constructor(factories, { bind = false } = {}) {
    this._factories = factories.slice();
    for (const factory3 of this._factories) {
      if (typeof factory3.prototype.init === "function") {
        factory3.prototype.init.call(this);
      }
      for (const method of factory3.exports || []) {
        if (bind) {
          this[method] = factory3.prototype[method].bind(this);
        } else {
          this[method] = factory3.prototype[method];
        }
      }
    }
  }
  clone() {
    const env = new _Environment(this._factories);
    for (const factory3 of env._factories) {
      if (typeof factory3.prototype.clone === "function") {
        factory3.prototype.clone.call(env, this);
      }
    }
    return env;
  }
};
var Environment_default = Environment;

// node_modules/@zazuko/env-core/lib/extend.js
function extend({ parent, child }) {
  const proxy = new Proxy({}, {
    get(target, prop) {
      return child[prop] || parent[prop];
    },
    set(target, prop, value) {
      child[prop] = value;
      return true;
    },
    has(target, prop) {
      return prop in child || prop in parent;
    },
    ownKeys() {
      const parentKeys = Object.getOwnPropertyNames(parent);
      const childKeys = Object.getOwnPropertyNames(child);
      return [...(/* @__PURE__ */ new Set([...parentKeys, ...childKeys])).values()];
    },
    getOwnPropertyDescriptor(target, prop) {
      return {
        enumerable: !prop.toString().startsWith("_"),
        configurable: true
      };
    }
  });
  return proxy;
}

// node_modules/@zazuko/env-core/Environment.js
var Environment2 = class _Environment {
  constructor(factoriesOrChild, { parent, bind = false } = {}) {
    this._parent = parent;
    if (factoriesOrChild instanceof Environment_default || factoriesOrChild instanceof _Environment) {
      return extend({ parent, child: factoriesOrChild });
    }
    this._factories = factoriesOrChild.slice();
    const extended = parent ? extend({ parent, child: this }) : this;
    for (const factory3 of this._factories) {
      if (typeof factory3.prototype.init === "function") {
        factory3.prototype.init.call(extended);
      }
      for (const method of factory3.exports || []) {
        if (bind) {
          this[method] = factory3.prototype[method].bind(extended);
        } else {
          this[method] = factory3.prototype[method];
        }
      }
    }
    return extended;
  }
  clone() {
    const env = new _Environment(this._factories, this._parent);
    for (const factory3 of env._factories) {
      if (typeof factory3.prototype.clone === "function") {
        factory3.prototype.clone.call(env, this);
      }
    }
    return env;
  }
};

// node_modules/@zazuko/env/Environment.js
var Environment_default2 = Environment2;

// node_modules/@zazuko/env/lib/DatasetFactoryExt.js
var import_toStream2 = __toESM(require_toStream(), 1);
var import_fromStream = __toESM(require_fromStream(), 1);
var import_toCanonical2 = __toESM(require_toCanonical(), 1);
var import_addAll2 = __toESM(require_addAll(), 1);

// node_modules/@zazuko/env/lib/DatasetFactory.js
var import_addAll = __toESM(require_addAll(), 1);
var import_deleteMatch = __toESM(require_deleteMatch(), 1);
var import_equals = __toESM(require_equals(), 1);
var DatasetFactory_default = (createConstructor2) => class {
  dataset;
  init() {
    const Dataset2 = createConstructor2(this);
    this.dataset = ((quads = []) => {
      return new Dataset2([...quads]);
    });
    this.dataset.Class = Dataset2;
    this.dataset.addAll = import_addAll.default;
    this.dataset.deleteMatch = import_deleteMatch.default;
    this.dataset.equals = import_equals.default;
  }
};

// web/shims/stream.js
var unavailable = (name) => {
  throw new Error(`${name} is not available in the browser build. Nothing should reach node streams here; see web/shims/stream.js.`);
};
var Transform = class {
  constructor() {
    unavailable("stream.Transform");
  }
};

// node_modules/is-stream/index.js
function isStream(stream, { checkOpen = true } = {}) {
  return stream !== null && typeof stream === "object" && (stream.writable || stream.readable || !checkOpen || stream.writable === void 0 && stream.readable === void 0) && typeof stream.pipe === "function";
}
function isReadableStream(stream, { checkOpen = true } = {}) {
  return isStream(stream, { checkOpen }) && (stream.readable || !checkOpen) && typeof stream.read === "function" && typeof stream.readable === "boolean" && typeof stream.readableObjectMode === "boolean" && typeof stream.destroy === "function" && typeof stream.destroyed === "boolean";
}

// node_modules/@sec-ant/readable-stream/dist/ponyfill/asyncIterator.js
var a = Object.getPrototypeOf(
  Object.getPrototypeOf(
    /* istanbul ignore next */
    async function* () {
    }
  ).prototype
);
var c = class {
  #t;
  #n;
  #r = false;
  #e = void 0;
  constructor(e, t) {
    this.#t = e, this.#n = t;
  }
  next() {
    const e = () => this.#s();
    return this.#e = this.#e ? this.#e.then(e, e) : e(), this.#e;
  }
  return(e) {
    const t = () => this.#i(e);
    return this.#e ? this.#e.then(t, t) : t();
  }
  async #s() {
    if (this.#r)
      return {
        done: true,
        value: void 0
      };
    let e;
    try {
      e = await this.#t.read();
    } catch (t) {
      throw this.#e = void 0, this.#r = true, this.#t.releaseLock(), t;
    }
    return e.done && (this.#e = void 0, this.#r = true, this.#t.releaseLock()), e;
  }
  async #i(e) {
    if (this.#r)
      return {
        done: true,
        value: e
      };
    if (this.#r = true, !this.#n) {
      const t = this.#t.cancel(e);
      return this.#t.releaseLock(), await t, {
        done: true,
        value: e
      };
    }
    return this.#t.releaseLock(), {
      done: true,
      value: e
    };
  }
};
var n = /* @__PURE__ */ Symbol();
function i() {
  return this[n].next();
}
Object.defineProperty(i, "name", { value: "next" });
function o(r) {
  return this[n].return(r);
}
Object.defineProperty(o, "name", { value: "return" });
var u = Object.create(a, {
  next: {
    enumerable: true,
    configurable: true,
    writable: true,
    value: i
  },
  return: {
    enumerable: true,
    configurable: true,
    writable: true,
    value: o
  }
});
function h({ preventCancel: r = false } = {}) {
  const e = this.getReader(), t = new c(
    e,
    r
  ), s = Object.create(u);
  return s[n] = t, s;
}

// node_modules/get-stream/source/stream.js
var getAsyncIterable = (stream) => {
  if (isReadableStream(stream, { checkOpen: false }) && nodeImports.on !== void 0) {
    return getStreamIterable(stream);
  }
  if (typeof stream?.[Symbol.asyncIterator] === "function") {
    return stream;
  }
  if (toString.call(stream) === "[object ReadableStream]") {
    return h.call(stream);
  }
  throw new TypeError("The first argument must be a Readable, a ReadableStream, or an async iterable.");
};
var { toString } = Object.prototype;
var getStreamIterable = async function* (stream) {
  const controller = new AbortController();
  const state = {};
  handleStreamEnd(stream, controller, state);
  try {
    for await (const [chunk] of nodeImports.on(stream, "data", { signal: controller.signal })) {
      yield chunk;
    }
  } catch (error2) {
    if (state.error !== void 0) {
      throw state.error;
    } else if (!controller.signal.aborted) {
      throw error2;
    }
  } finally {
    stream.destroy();
  }
};
var handleStreamEnd = async (stream, controller, state) => {
  try {
    await nodeImports.finished(stream, {
      cleanup: true,
      readable: true,
      writable: false,
      error: false
    });
  } catch (error2) {
    state.error = error2;
  } finally {
    controller.abort();
  }
};
var nodeImports = {};

// node_modules/get-stream/source/contents.js
var getStreamContents = async (stream, { init: init2, convertChunk, getSize, truncateChunk, addChunk, getFinalChunk, finalize }, { maxBuffer = Number.POSITIVE_INFINITY } = {}) => {
  const asyncIterable = getAsyncIterable(stream);
  const state = init2();
  state.length = 0;
  try {
    for await (const chunk of asyncIterable) {
      const chunkType = getChunkType(chunk);
      const convertedChunk = convertChunk[chunkType](chunk, state);
      appendChunk({
        convertedChunk,
        state,
        getSize,
        truncateChunk,
        addChunk,
        maxBuffer
      });
    }
    appendFinalChunk({
      state,
      convertChunk,
      getSize,
      truncateChunk,
      addChunk,
      getFinalChunk,
      maxBuffer
    });
    return finalize(state);
  } catch (error2) {
    const normalizedError = typeof error2 === "object" && error2 !== null ? error2 : new Error(error2);
    normalizedError.bufferedData = finalize(state);
    throw normalizedError;
  }
};
var appendFinalChunk = ({ state, getSize, truncateChunk, addChunk, getFinalChunk, maxBuffer }) => {
  const convertedChunk = getFinalChunk(state);
  if (convertedChunk !== void 0) {
    appendChunk({
      convertedChunk,
      state,
      getSize,
      truncateChunk,
      addChunk,
      maxBuffer
    });
  }
};
var appendChunk = ({ convertedChunk, state, getSize, truncateChunk, addChunk, maxBuffer }) => {
  const chunkSize = getSize(convertedChunk);
  const newLength = state.length + chunkSize;
  if (newLength <= maxBuffer) {
    addNewChunk(convertedChunk, state, addChunk, newLength);
    return;
  }
  const truncatedChunk = truncateChunk(convertedChunk, maxBuffer - state.length);
  if (truncatedChunk !== void 0) {
    addNewChunk(truncatedChunk, state, addChunk, maxBuffer);
  }
  throw new MaxBufferError();
};
var addNewChunk = (convertedChunk, state, addChunk, newLength) => {
  state.contents = addChunk(convertedChunk, state, newLength);
  state.length = newLength;
};
var getChunkType = (chunk) => {
  const typeOfChunk = typeof chunk;
  if (typeOfChunk === "string") {
    return "string";
  }
  if (typeOfChunk !== "object" || chunk === null) {
    return "others";
  }
  if (globalThis.Buffer?.isBuffer(chunk)) {
    return "buffer";
  }
  const prototypeName = objectToString.call(chunk);
  if (prototypeName === "[object ArrayBuffer]") {
    return "arrayBuffer";
  }
  if (prototypeName === "[object DataView]") {
    return "dataView";
  }
  if (Number.isInteger(chunk.byteLength) && Number.isInteger(chunk.byteOffset) && objectToString.call(chunk.buffer) === "[object ArrayBuffer]") {
    return "typedArray";
  }
  return "others";
};
var { toString: objectToString } = Object.prototype;
var MaxBufferError = class extends Error {
  name = "MaxBufferError";
  constructor() {
    super("maxBuffer exceeded");
  }
};

// node_modules/get-stream/source/utils.js
var identity = (value) => value;
var getContentsProperty = ({ contents }) => contents;
var throwObjectStream = (chunk) => {
  throw new Error(`Streams in object mode are not supported: ${String(chunk)}`);
};
var getLengthProperty = (convertedChunk) => convertedChunk.length;

// node_modules/get-stream/source/string.js
async function getStreamAsString(stream, options) {
  return getStreamContents(stream, stringMethods, options);
}
var initString = () => ({ contents: "", textDecoder: new TextDecoder() });
var useTextDecoder = (chunk, { textDecoder }) => textDecoder.decode(chunk, { stream: true });
var addStringChunk = (convertedChunk, { contents }) => contents + convertedChunk;
var truncateStringChunk = (convertedChunk, chunkSize) => convertedChunk.slice(0, chunkSize);
var getFinalStringChunk = ({ textDecoder }) => {
  const finalChunk = textDecoder.decode();
  return finalChunk === "" ? void 0 : finalChunk;
};
var stringMethods = {
  init: initString,
  convertChunk: {
    string: identity,
    buffer: useTextDecoder,
    arrayBuffer: useTextDecoder,
    dataView: useTextDecoder,
    typedArray: useTextDecoder,
    others: throwObjectStream
  },
  getSize: getLengthProperty,
  truncateChunk: truncateStringChunk,
  addChunk: addStringChunk,
  getFinalChunk: getFinalStringChunk,
  finalize: getContentsProperty
};

// node_modules/@zazuko/prefixes/lib/prefixesOnly.js
var prefixesOnly_default = {
  rif: "http://www.w3.org/2007/rif#",
  v: "http://rdf.data-vocabulary.org/#",
  wdr: "http://www.w3.org/2007/05/powder#",
  xml: "http://www.w3.org/XML/1998/namespace/"
};

// node_modules/@zazuko/prefixes/prefixes.js
var packagedPrefixes = {
  acl: "http://www.w3.org/ns/auth/acl#",
  as: "https://www.w3.org/ns/activitystreams#",
  b59: "https://barnard59.zazuko.com/vocab#",
  bibo: "http://purl.org/ontology/bibo/",
  cc: "http://creativecommons.org/ns#",
  cert: "http://www.w3.org/ns/auth/cert#",
  cnt: "http://www.w3.org/2011/content#",
  code: "https://code.described.at/",
  constant: "http://qudt.org/vocab/constant/",
  crm: "http://www.cidoc-crm.org/cidoc-crm/",
  csvw: "http://www.w3.org/ns/csvw#",
  ctag: "http://commontag.org/ns#",
  cube: "https://cube.link/",
  cur: "http://qudt.org/vocab/currency/",
  "dash-sparql": "http://datashapes.org/sparql#",
  dash: "http://datashapes.org/dash#",
  dbo: "http://dbpedia.org/ontology/",
  dc11: "http://purl.org/dc/elements/1.1/",
  dcam: "http://purl.org/dc/dcam/",
  dcat: "http://www.w3.org/ns/dcat#",
  dcmitype: "http://purl.org/dc/dcmitype/",
  dcterms: "http://purl.org/dc/terms/",
  dig: "http://www.ics.forth.gr/isl/CRMdig/",
  discipline: "http://qudt.org/vocab/discipline/",
  doap: "http://usefulinc.com/ns/doap#",
  dprod: "https://ekgf.github.io/dprod/",
  dpv: "http://www.w3.org/ns/dpv#",
  dqv: "http://www.w3.org/ns/dqv#",
  dtype: "http://www.linkedmodel.org/schema/dtype#",
  duv: "http://www.w3.org/ns/duv#",
  earl: "http://www.w3.org/ns/earl#",
  ebucore: "http://www.ebu.ch/metadata/ontologies/ebucore/ebucore#",
  exif: "http://www.w3.org/2003/12/exif/ns#",
  foaf: "http://xmlns.com/foaf/0.1/",
  frbr: "http://purl.org/vocab/frbr/core#",
  geo: "http://www.opengis.net/ont/geosparql#",
  geof: "http://www.opengis.net/def/function/geosparql/",
  geor: "http://www.opengis.net/def/rule/geosparql/",
  gml: "http://www.opengis.net/ont/gml#",
  gn: "http://www.geonames.org/ontology#",
  gr: "http://purl.org/goodrelations/v1#",
  grddl: "http://www.w3.org/2003/g/data-view#",
  gs1: "https://gs1.org/voc/",
  gtfs: "http://vocab.gtfs.org/terms#",
  http: "http://www.w3.org/2011/http#",
  hydra: "http://www.w3.org/ns/hydra/core#",
  ical: "http://www.w3.org/2002/12/cal/icaltzd#",
  la: "https://linked.art/ns/terms/",
  ldp: "http://www.w3.org/ns/ldp#",
  list: "http://www.w3.org/2000/10/swap/list#",
  locn: "http://www.w3.org/ns/locn#",
  log: "http://www.w3.org/2000/10/swap/log#",
  lvont: "http://lexvo.org/ontology#",
  m4i: "http://w3id.org/nfdi4ing/metadata4ing#",
  ma: "http://www.w3.org/ns/ma-ont#",
  mads: "http://www.loc.gov/mads/rdf/v1#",
  math: "http://www.w3.org/2000/10/swap/math#",
  meta: "https://cube.link/meta/",
  oa: "http://www.w3.org/ns/oa#",
  og: "http://ogp.me/ns#",
  oidc: "http://www.w3.org/ns/solid/oidc#",
  org: "http://www.w3.org/ns/org#",
  owl: "http://www.w3.org/2002/07/owl#",
  pim: "http://www.w3.org/ns/pim/space#",
  pipeline: "https://pipeline.described.at/",
  prefix: "http://qudt.org/vocab/prefix/",
  prov: "http://www.w3.org/ns/prov#",
  qb: "http://purl.org/linked-data/cube#",
  qkdv: "http://qudt.org/vocab/dimensionvector/",
  quantitykind: "http://qudt.org/vocab/quantitykind/",
  qudt: "http://qudt.org/schema/qudt/",
  rdau: "http://rdaregistry.info/Elements/u/",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfa: "http://www.w3.org/ns/rdfa#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  relation: "https://cube.link/relation/",
  rev: "http://purl.org/stuff/rev#",
  rico: "https://www.ica.org/standards/RiC/ontology#",
  rr: "http://www.w3.org/ns/r2rml#",
  rss: "http://purl.org/rss/1.0/",
  schema: "http://schema.org/",
  sd: "http://www.w3.org/ns/sparql-service-description#",
  sdmx: "http://purl.org/linked-data/sdmx#",
  sem: "http://semanticweb.cs.vu.nl/2009/11/sem/",
  set: "http://www.w3.org/2000/10/swap/set#",
  sf: "http://www.opengis.net/ont/sf#",
  sh: "http://www.w3.org/ns/shacl#",
  shex: "http://www.w3.org/ns/shex#",
  shsh: "http://www.w3.org/ns/shacl-shacl#",
  sioc: "http://rdfs.org/sioc/ns#",
  skos: "http://www.w3.org/2004/02/skos/core#",
  skosxl: "http://www.w3.org/2008/05/skos-xl#",
  solid: "http://www.w3.org/ns/solid/terms#",
  sosa: "http://www.w3.org/ns/sosa/",
  sou: "http://qudt.org/vocab/sou/",
  ssn: "http://www.w3.org/ns/ssn/",
  stat: "http://www.w3.org/ns/posix/stat#",
  string: "http://www.w3.org/2000/10/swap/string#",
  test: "http://www.w3.org/2006/03/test-description#",
  time: "http://www.w3.org/2006/time#",
  unit: "http://qudt.org/vocab/unit/",
  vaem: "http://www.linkedmodel.org/schema/vaem#",
  vann: "http://purl.org/vocab/vann/",
  vcard: "http://www.w3.org/2006/vcard/ns#",
  void: "http://rdfs.org/ns/void#",
  vs: "http://www.w3.org/2003/06/sw-vocab-status/ns#",
  vso: "http://purl.org/vso/ns#",
  wdrs: "http://www.w3.org/2007/05/powder-s#",
  wgs: "http://www.w3.org/2003/01/geo/wgs84_pos#",
  xhv: "http://www.w3.org/1999/xhtml/vocab#",
  xkos: "http://rdf-vocabulary.ddialliance.org/xkos#",
  xsd: "http://www.w3.org/2001/XMLSchema#"
};
var prefixes = {
  ...packagedPrefixes,
  ...prefixesOnly_default
};
var prefixes_default = prefixes;

// node_modules/@zazuko/prefixes/index.js
var prefixes_default2 = prefixes_default;

// node_modules/@zazuko/env/lib/serialize.js
var import_toCanonical = __toESM(require_toCanonical(), 1);
var import_toStream = __toESM(require_toStream(), 1);
async function serialize(env, dataset2, { renameBlankNodes, format, prefixes: prefixes2 = [] }) {
  const serializer = env.formats.serializers.get(format);
  if (!serializer) {
    return (0, import_toCanonical.default)(dataset2);
  }
  let stream = (0, import_toStream.default)(dataset2);
  if (renameBlankNodes) {
    stream = stream.pipe(new RenameBlankNodes(env));
  }
  return getStreamAsString(serializer.import(stream, {
    prefixes: prefixes2.reduce((map, prefix) => {
      if (Array.isArray(prefix)) {
        return { ...map, [prefix[0]]: prefix[1] };
      }
      if (prefix in prefixes_default2) {
        return { ...map, [prefix]: prefixes_default2[prefix] };
      }
      return map;
    }, {})
  }));
}
var RenameBlankNodes = class extends Transform {
  env;
  blankNodes;
  constructor(env) {
    super({ objectMode: true });
    this.env = env;
    this.blankNodes = env.termMap();
  }
  _transform(chunk, encoding, callback) {
    let replaced = false;
    let { subject, predicate, object } = chunk;
    if (subject && subject.termType === "BlankNode") {
      subject = this.replaceBlankNode(subject);
      replaced = true;
    }
    if (object && object.termType === "BlankNode") {
      object = this.replaceBlankNode(object);
      replaced = true;
    }
    if (!replaced) {
      callback(null, chunk);
    } else {
      callback(null, this.env.quad(subject, predicate, object));
    }
  }
  replaceBlankNode(original) {
    if (!this.blankNodes.has(original)) {
      const replacement = this.env.blankNode(`t${this.blankNodes.size}`);
      this.blankNodes.set(original, replacement);
    }
    return this.blankNodes.get(original);
  }
};

// node_modules/@zazuko/env/lib/DatasetFactoryExt.js
var DatasetFactoryExt_default = (createConstructor2) => class extends DatasetFactory_default(createConstructor2) {
  init() {
    super.init();
    this.dataset.toCanonical = import_toCanonical2.default;
    this.dataset.toStream = import_toStream2.default;
    this.dataset.fromStream = (stream) => {
      return (0, import_fromStream.default)(this.dataset(), stream);
    };
    this.dataset.serialize = serialize.bind(null, this);
    this.dataset.import = async (d, stream) => {
      return (0, import_addAll2.default)(d, await this.dataset.fromStream(stream));
    };
  }
};

// node_modules/@rdfjs/data-model/lib/BlankNode.js
var BlankNode = class {
  constructor(id) {
    this.value = id;
  }
  equals(other) {
    return !!other && other.termType === this.termType && other.value === this.value;
  }
};
BlankNode.prototype.termType = "BlankNode";
var BlankNode_default = BlankNode;

// node_modules/@rdfjs/data-model/lib/DefaultGraph.js
var DefaultGraph = class {
  equals(other) {
    return !!other && other.termType === this.termType;
  }
};
DefaultGraph.prototype.termType = "DefaultGraph";
DefaultGraph.prototype.value = "";
var DefaultGraph_default = DefaultGraph;

// node_modules/@rdfjs/data-model/lib/fromTerm.js
function fromTerm(factory3, original) {
  if (!original) {
    return null;
  }
  if (original.termType === "BlankNode") {
    return factory3.blankNode(original.value);
  }
  if (original.termType === "DefaultGraph") {
    return factory3.defaultGraph();
  }
  if (original.termType === "Literal") {
    return factory3.literal(original.value, original.language ? { language: original.language, direction: original.direction } : factory3.namedNode(original.datatype.value));
  }
  if (original.termType === "NamedNode") {
    return factory3.namedNode(original.value);
  }
  if (original.termType === "Quad") {
    const subject = factory3.fromTerm(original.subject);
    const predicate = factory3.fromTerm(original.predicate);
    const object = factory3.fromTerm(original.object);
    const graph = factory3.fromTerm(original.graph);
    return factory3.quad(subject, predicate, object, graph);
  }
  if (original.termType === "Variable") {
    return factory3.variable(original.value);
  }
  throw new Error(`unknown termType ${original.termType}`);
}
var fromTerm_default = fromTerm;

// node_modules/@rdfjs/data-model/lib/Literal.js
var Literal = class {
  constructor(value, language, datatype, direction = "") {
    this.value = value;
    this.language = language;
    this.datatype = datatype;
    this.direction = direction;
  }
  equals(other) {
    return !!other && other.termType === this.termType && other.value === this.value && other.language === this.language && other.datatype.equals(this.datatype) && (other.direction || "") === this.direction;
  }
};
Literal.prototype.termType = "Literal";
var Literal_default = Literal;

// node_modules/@rdfjs/data-model/lib/NamedNode.js
var NamedNode = class {
  constructor(iri4) {
    this.value = iri4;
  }
  equals(other) {
    return !!other && other.termType === this.termType && other.value === this.value;
  }
};
NamedNode.prototype.termType = "NamedNode";
var NamedNode_default = NamedNode;

// node_modules/@rdfjs/data-model/lib/Quad.js
var Quad = class {
  constructor(subject, predicate, object, graph) {
    this.subject = subject;
    this.predicate = predicate;
    this.object = object;
    this.graph = graph;
  }
  equals(other) {
    return !!other && (other.termType === "Quad" || !other.termType) && other.subject.equals(this.subject) && other.predicate.equals(this.predicate) && other.object.equals(this.object) && other.graph.equals(this.graph);
  }
};
Quad.prototype.termType = "Quad";
Quad.prototype.value = "";
var Quad_default = Quad;

// node_modules/@rdfjs/data-model/lib/Variable.js
var Variable = class {
  constructor(name) {
    this.value = name;
  }
  equals(other) {
    return !!other && other.termType === this.termType && other.value === this.value;
  }
};
Variable.prototype.termType = "Variable";
var Variable_default = Variable;

// node_modules/@rdfjs/data-model/Factory.js
var dirLangStringDatatype = new NamedNode_default("http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString");
var langStringDatatype = new NamedNode_default("http://www.w3.org/1999/02/22-rdf-syntax-ns#langString");
var stringDatatype = new NamedNode_default("http://www.w3.org/2001/XMLSchema#string");
var DataFactory = class {
  constructor() {
    this.init();
  }
  init() {
    this._data = {
      blankNodeCounter: 0,
      defaultGraph: new DefaultGraph_default()
    };
  }
  namedNode(value) {
    return new NamedNode_default(value);
  }
  blankNode(value) {
    value = value || "b" + ++this._data.blankNodeCounter;
    return new BlankNode_default(value);
  }
  literal(value, languageOrDatatype) {
    if (typeof languageOrDatatype === "string") {
      return new Literal_default(value, languageOrDatatype, langStringDatatype);
    } else if (typeof languageOrDatatype?.language === "string") {
      return new Literal_default(
        value,
        languageOrDatatype.language,
        languageOrDatatype.direction ? dirLangStringDatatype : langStringDatatype,
        languageOrDatatype.direction
      );
    } else {
      return new Literal_default(value, "", languageOrDatatype || stringDatatype);
    }
  }
  variable(value) {
    return new Variable_default(value);
  }
  defaultGraph() {
    return this._data.defaultGraph;
  }
  quad(subject, predicate, object, graph = this.defaultGraph()) {
    return new Quad_default(subject, predicate, object, graph);
  }
  fromTerm(original) {
    return fromTerm_default(this, original);
  }
  fromQuad(original) {
    return fromTerm_default(this, original);
  }
};
DataFactory.exports = [
  "blankNode",
  "defaultGraph",
  "fromQuad",
  "fromTerm",
  "literal",
  "namedNode",
  "quad",
  "variable"
];
var Factory_default = DataFactory;

// node_modules/@rdfjs/sink-map/index.js
var SinkMap = class extends Map {
  import(key, input, options) {
    const parser = this.get(key);
    if (!parser) {
      return null;
    }
    return parser.import(input, options);
  }
};
var sink_map_default = SinkMap;

// node_modules/@rdfjs/formats/lib/Formats.js
var Formats = class {
  constructor({ factory: factory3 }) {
    this.factory = factory3;
    this.parsers = new sink_map_default();
    this.serializers = new sink_map_default();
  }
  import(other) {
    if (other.parsers) {
      for (const [mediaType, parser] of other.parsers) {
        this.parsers.set(mediaType, new parser.constructor({ factory: this.factory }));
      }
    }
    if (other.serializers) {
      for (const [mediaType, serializer] of other.serializers) {
        this.serializers.set(mediaType, new serializer.constructor({ factory: this.factory }));
      }
    }
    return this;
  }
};
var Formats_default = Formats;

// node_modules/@rdfjs/formats/Factory.js
var Factory = class {
  init() {
    this.formats = new Formats_default({ factory: this });
  }
  clone(original) {
    this.formats.import(original.formats);
  }
};
var Factory_default2 = Factory;

// node_modules/@rdfjs/data-model/index.js
var factory = new Factory_default();
var data_model_default = factory;

// node_modules/@rdfjs/namespace/index.js
var handler = {
  apply: (target, thisArg, args) => target(args[0]),
  get: (target, property) => target(property)
};
function namespace(baseIRI, { factory: factory3 = data_model_default } = {}) {
  const builder111 = (term2 = "") => factory3.namedNode(`${baseIRI}${term2.raw || term2}`);
  return typeof Proxy === "undefined" ? builder111 : new Proxy(builder111, handler);
}
var namespace_default = namespace;

// node_modules/@rdfjs/namespace/Factory.js
var Factory2 = class {
  namespace(baseIRI) {
    return namespace_default(baseIRI, { factory: this });
  }
};
Factory2.exports = ["namespace"];
var Factory_default3 = Factory2;

// node_modules/@tpluscode/rdf-ns-builders/index.js
var rdf_ns_builders_exports = {};
__export(rdf_ns_builders_exports, {
  _void: () => strict99,
  acl: () => strict,
  as: () => strict2,
  bibo: () => strict3,
  cc: () => strict4,
  cert: () => strict5,
  cnt: () => strict6,
  constant: () => strict7,
  crm: () => strict8,
  csvw: () => strict9,
  ctag: () => strict10,
  cur: () => strict11,
  dash: () => strict13,
  dashSparql: () => strict12,
  dbo: () => strict14,
  dc11: () => strict15,
  dcam: () => strict16,
  dcat: () => strict17,
  dcmitype: () => strict18,
  dcterms: () => strict19,
  default: () => rdf_ns_builders_default,
  dig: () => strict20,
  discipline: () => strict21,
  doap: () => strict22,
  dprod: () => strict23,
  dpv: () => strict24,
  dqv: () => strict25,
  dtype: () => strict26,
  duv: () => strict27,
  earl: () => strict28,
  ebucore: () => strict29,
  exif: () => strict30,
  foaf: () => strict31,
  frbr: () => strict32,
  geo: () => strict33,
  geof: () => strict34,
  geor: () => strict35,
  gml: () => strict36,
  gn: () => strict37,
  gr: () => strict38,
  grddl: () => strict39,
  gs1: () => strict40,
  gtfs: () => strict41,
  http: () => strict42,
  hydra: () => strict43,
  ical: () => strict44,
  la: () => strict45,
  ldp: () => strict46,
  list: () => strict47,
  locn: () => strict48,
  log: () => strict49,
  lvont: () => strict50,
  m4i: () => strict51,
  ma: () => strict52,
  mads: () => strict53,
  math: () => strict54,
  oa: () => strict55,
  og: () => strict56,
  oidc: () => strict57,
  org: () => strict58,
  owl: () => strict59,
  pim: () => strict60,
  prefix: () => strict61,
  prov: () => strict62,
  qb: () => strict63,
  qkdv: () => strict64,
  quantitykind: () => strict65,
  qudt: () => strict66,
  rdau: () => strict67,
  rdf: () => strict68,
  rdfa: () => strict69,
  rdfs: () => strict70,
  rev: () => strict71,
  rico: () => strict72,
  rif: () => strict107,
  rr: () => strict73,
  rss: () => strict74,
  schema: () => strict75,
  sd: () => strict76,
  sdmx: () => strict77,
  sem: () => strict78,
  set: () => strict79,
  sf: () => strict80,
  sh: () => strict81,
  shex: () => strict82,
  shsh: () => strict83,
  sioc: () => strict84,
  skos: () => strict85,
  skosxl: () => strict86,
  solid: () => strict87,
  sosa: () => strict88,
  sou: () => strict89,
  ssn: () => strict90,
  stat: () => strict91,
  string: () => strict92,
  test: () => strict93,
  time: () => strict94,
  unit: () => strict95,
  v: () => strict108,
  vaem: () => strict96,
  vann: () => strict97,
  vcard: () => strict98,
  vs: () => strict100,
  vso: () => strict101,
  wdr: () => strict109,
  wdrs: () => strict102,
  wgs: () => strict103,
  xhv: () => strict104,
  xkos: () => strict105,
  xml: () => strict110,
  xsd: () => strict106
});

// node_modules/@tpluscode/rdf-ns-builders/Factory.js
var NsBuildersFactory = class {
  init() {
    this.ns = rdf_ns_builders_exports;
  }
};

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/acl.js
var builder = namespace_default("http://www.w3.org/ns/auth/acl#");
var strict = builder;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/as.js
var builder2 = namespace_default("https://www.w3.org/ns/activitystreams#");
var strict2 = builder2;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/bibo.js
var builder3 = namespace_default("http://purl.org/ontology/bibo/");
var strict3 = builder3;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/cc.js
var builder4 = namespace_default("http://creativecommons.org/ns#");
var strict4 = builder4;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/cert.js
var builder5 = namespace_default("http://www.w3.org/ns/auth/cert#");
var strict5 = builder5;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/cnt.js
var builder6 = namespace_default("http://www.w3.org/2011/content#");
var strict6 = builder6;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/constant.js
var builder7 = namespace_default("http://qudt.org/vocab/constant/");
var strict7 = builder7;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/crm.js
var builder8 = namespace_default("http://www.cidoc-crm.org/cidoc-crm/");
var strict8 = builder8;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/csvw.js
var builder9 = namespace_default("http://www.w3.org/ns/csvw#");
var strict9 = builder9;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/ctag.js
var builder10 = namespace_default("http://commontag.org/ns#");
var strict10 = builder10;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/cur.js
var builder11 = namespace_default("http://qudt.org/vocab/currency/");
var strict11 = builder11;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/dash-sparql.js
var builder12 = namespace_default("http://datashapes.org/sparql#");
var strict12 = builder12;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/dash.js
var builder13 = namespace_default("http://datashapes.org/dash#");
var strict13 = builder13;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/dbo.js
var builder14 = namespace_default("http://dbpedia.org/ontology/");
var strict14 = builder14;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/dc11.js
var builder15 = namespace_default("http://purl.org/dc/elements/1.1/");
var strict15 = builder15;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/dcam.js
var builder16 = namespace_default("http://purl.org/dc/dcam/");
var strict16 = builder16;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/dcat.js
var builder17 = namespace_default("http://www.w3.org/ns/dcat#");
var strict17 = builder17;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/dcmitype.js
var builder18 = namespace_default("http://purl.org/dc/dcmitype/");
var strict18 = builder18;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/dcterms.js
var builder19 = namespace_default("http://purl.org/dc/terms/");
var strict19 = builder19;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/dig.js
var builder20 = namespace_default("http://www.ics.forth.gr/isl/CRMdig/");
var strict20 = builder20;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/discipline.js
var builder21 = namespace_default("http://qudt.org/vocab/discipline/");
var strict21 = builder21;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/doap.js
var builder22 = namespace_default("http://usefulinc.com/ns/doap#");
var strict22 = builder22;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/dprod.js
var builder23 = namespace_default("https://ekgf.github.io/dprod/");
var strict23 = builder23;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/dpv.js
var builder24 = namespace_default("http://www.w3.org/ns/dpv#");
var strict24 = builder24;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/dqv.js
var builder25 = namespace_default("http://www.w3.org/ns/dqv#");
var strict25 = builder25;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/dtype.js
var builder26 = namespace_default("http://www.linkedmodel.org/schema/dtype#");
var strict26 = builder26;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/duv.js
var builder27 = namespace_default("http://www.w3.org/ns/duv#");
var strict27 = builder27;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/earl.js
var builder28 = namespace_default("http://www.w3.org/ns/earl#");
var strict28 = builder28;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/ebucore.js
var builder29 = namespace_default("http://www.ebu.ch/metadata/ontologies/ebucore/ebucore#");
var strict29 = builder29;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/exif.js
var builder30 = namespace_default("http://www.w3.org/2003/12/exif/ns#");
var strict30 = builder30;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/foaf.js
var builder31 = namespace_default("http://xmlns.com/foaf/0.1/");
var strict31 = builder31;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/frbr.js
var builder32 = namespace_default("http://purl.org/vocab/frbr/core#");
var strict32 = builder32;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/geo.js
var builder33 = namespace_default("http://www.opengis.net/ont/geosparql#");
var strict33 = builder33;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/geof.js
var builder34 = namespace_default("http://www.opengis.net/def/function/geosparql/");
var strict34 = builder34;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/geor.js
var builder35 = namespace_default("http://www.opengis.net/def/rule/geosparql/");
var strict35 = builder35;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/gml.js
var builder36 = namespace_default("http://www.opengis.net/ont/gml#");
var strict36 = builder36;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/gn.js
var builder37 = namespace_default("http://www.geonames.org/ontology#");
var strict37 = builder37;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/gr.js
var builder38 = namespace_default("http://purl.org/goodrelations/v1#");
var strict38 = builder38;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/grddl.js
var builder39 = namespace_default("http://www.w3.org/2003/g/data-view#");
var strict39 = builder39;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/gs1.js
var builder40 = namespace_default("https://gs1.org/voc/");
var strict40 = builder40;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/gtfs.js
var builder41 = namespace_default("http://vocab.gtfs.org/terms#");
var strict41 = builder41;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/http.js
var builder42 = namespace_default("http://www.w3.org/2011/http#");
var strict42 = builder42;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/hydra.js
var builder43 = namespace_default("http://www.w3.org/ns/hydra/core#");
var strict43 = builder43;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/ical.js
var builder44 = namespace_default("http://www.w3.org/2002/12/cal/icaltzd#");
var strict44 = builder44;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/la.js
var builder45 = namespace_default("https://linked.art/ns/terms/");
var strict45 = builder45;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/ldp.js
var builder46 = namespace_default("http://www.w3.org/ns/ldp#");
var strict46 = builder46;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/list.js
var builder47 = namespace_default("http://www.w3.org/2000/10/swap/list#");
var strict47 = builder47;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/locn.js
var builder48 = namespace_default("http://www.w3.org/ns/locn#");
var strict48 = builder48;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/log.js
var builder49 = namespace_default("http://www.w3.org/2000/10/swap/log#");
var strict49 = builder49;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/lvont.js
var builder50 = namespace_default("http://lexvo.org/ontology#");
var strict50 = builder50;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/m4i.js
var builder51 = namespace_default("http://w3id.org/nfdi4ing/metadata4ing#");
var strict51 = builder51;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/ma.js
var builder52 = namespace_default("http://www.w3.org/ns/ma-ont#");
var strict52 = builder52;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/mads.js
var builder53 = namespace_default("http://www.loc.gov/mads/rdf/v1#");
var strict53 = builder53;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/math.js
var builder54 = namespace_default("http://www.w3.org/2000/10/swap/math#");
var strict54 = builder54;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/oa.js
var builder55 = namespace_default("http://www.w3.org/ns/oa#");
var strict55 = builder55;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/og.js
var builder56 = namespace_default("http://ogp.me/ns#");
var strict56 = builder56;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/oidc.js
var builder57 = namespace_default("http://www.w3.org/ns/solid/oidc#");
var strict57 = builder57;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/org.js
var builder58 = namespace_default("http://www.w3.org/ns/org#");
var strict58 = builder58;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/owl.js
var builder59 = namespace_default("http://www.w3.org/2002/07/owl#");
var strict59 = builder59;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/pim.js
var builder60 = namespace_default("http://www.w3.org/ns/pim/space#");
var strict60 = builder60;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/prefix.js
var builder61 = namespace_default("http://qudt.org/vocab/prefix/");
var strict61 = builder61;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/prov.js
var builder62 = namespace_default("http://www.w3.org/ns/prov#");
var strict62 = builder62;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/qb.js
var builder63 = namespace_default("http://purl.org/linked-data/cube#");
var strict63 = builder63;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/qkdv.js
var builder64 = namespace_default("http://qudt.org/vocab/dimensionvector/");
var strict64 = builder64;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/quantitykind.js
var builder65 = namespace_default("http://qudt.org/vocab/quantitykind/");
var strict65 = builder65;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/qudt.js
var builder66 = namespace_default("http://qudt.org/schema/qudt/");
var strict66 = builder66;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/rdau.js
var builder67 = namespace_default("http://rdaregistry.info/Elements/u/");
var strict67 = builder67;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/rdf.js
var builder68 = namespace_default("http://www.w3.org/1999/02/22-rdf-syntax-ns#");
var strict68 = builder68;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/rdfa.js
var builder69 = namespace_default("http://www.w3.org/ns/rdfa#");
var strict69 = builder69;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/rdfs.js
var builder70 = namespace_default("http://www.w3.org/2000/01/rdf-schema#");
var strict70 = builder70;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/rev.js
var builder71 = namespace_default("http://purl.org/stuff/rev#");
var strict71 = builder71;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/rico.js
var builder72 = namespace_default("https://www.ica.org/standards/RiC/ontology#");
var strict72 = builder72;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/rr.js
var builder73 = namespace_default("http://www.w3.org/ns/r2rml#");
var strict73 = builder73;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/rss.js
var builder74 = namespace_default("http://purl.org/rss/1.0/");
var strict74 = builder74;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/schema.js
var builder75 = namespace_default("http://schema.org/");
var strict75 = builder75;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/sd.js
var builder76 = namespace_default("http://www.w3.org/ns/sparql-service-description#");
var strict76 = builder76;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/sdmx.js
var builder77 = namespace_default("http://purl.org/linked-data/sdmx#");
var strict77 = builder77;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/sem.js
var builder78 = namespace_default("http://semanticweb.cs.vu.nl/2009/11/sem/");
var strict78 = builder78;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/set.js
var builder79 = namespace_default("http://www.w3.org/2000/10/swap/set#");
var strict79 = builder79;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/sf.js
var builder80 = namespace_default("http://www.opengis.net/ont/sf#");
var strict80 = builder80;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/sh.js
var builder81 = namespace_default("http://www.w3.org/ns/shacl#");
var strict81 = builder81;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/shex.js
var builder82 = namespace_default("http://www.w3.org/ns/shex#");
var strict82 = builder82;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/shsh.js
var builder83 = namespace_default("http://www.w3.org/ns/shacl-shacl#");
var strict83 = builder83;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/sioc.js
var builder84 = namespace_default("http://rdfs.org/sioc/ns#");
var strict84 = builder84;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/skos.js
var builder85 = namespace_default("http://www.w3.org/2004/02/skos/core#");
var strict85 = builder85;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/skosxl.js
var builder86 = namespace_default("http://www.w3.org/2008/05/skos-xl#");
var strict86 = builder86;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/solid.js
var builder87 = namespace_default("http://www.w3.org/ns/solid/terms#");
var strict87 = builder87;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/sosa.js
var builder88 = namespace_default("http://www.w3.org/ns/sosa/");
var strict88 = builder88;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/sou.js
var builder89 = namespace_default("http://qudt.org/vocab/sou/");
var strict89 = builder89;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/ssn.js
var builder90 = namespace_default("http://www.w3.org/ns/ssn/");
var strict90 = builder90;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/stat.js
var builder91 = namespace_default("http://www.w3.org/ns/posix/stat#");
var strict91 = builder91;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/string.js
var builder92 = namespace_default("http://www.w3.org/2000/10/swap/string#");
var strict92 = builder92;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/test.js
var builder93 = namespace_default("http://www.w3.org/2006/03/test-description#");
var strict93 = builder93;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/time.js
var builder94 = namespace_default("http://www.w3.org/2006/time#");
var strict94 = builder94;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/unit.js
var builder95 = namespace_default("http://qudt.org/vocab/unit/");
var strict95 = builder95;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/vaem.js
var builder96 = namespace_default("http://www.linkedmodel.org/schema/vaem#");
var strict96 = builder96;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/vann.js
var builder97 = namespace_default("http://purl.org/vocab/vann/");
var strict97 = builder97;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/vcard.js
var builder98 = namespace_default("http://www.w3.org/2006/vcard/ns#");
var strict98 = builder98;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/void.js
var builder99 = namespace_default("http://rdfs.org/ns/void#");
var strict99 = builder99;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/vs.js
var builder100 = namespace_default("http://www.w3.org/2003/06/sw-vocab-status/ns#");
var strict100 = builder100;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/vso.js
var builder101 = namespace_default("http://purl.org/vso/ns#");
var strict101 = builder101;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/wdrs.js
var builder102 = namespace_default("http://www.w3.org/2007/05/powder-s#");
var strict102 = builder102;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/wgs.js
var builder103 = namespace_default("http://www.w3.org/2003/01/geo/wgs84_pos#");
var strict103 = builder103;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/xhv.js
var builder104 = namespace_default("http://www.w3.org/1999/xhtml/vocab#");
var strict104 = builder104;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/xkos.js
var builder105 = namespace_default("http://rdf-vocabulary.ddialliance.org/xkos#");
var strict105 = builder105;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/xsd.js
var builder106 = namespace_default("http://www.w3.org/2001/XMLSchema#");
var strict106 = builder106;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/rif.js
var builder107 = namespace_default("http://www.w3.org/2007/rif#");
var strict107 = builder107;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/v.js
var builder108 = namespace_default("http://rdf.data-vocabulary.org/#");
var strict108 = builder108;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/wdr.js
var builder109 = namespace_default("http://www.w3.org/2007/05/powder#");
var strict109 = builder109;

// node_modules/@tpluscode/rdf-ns-builders/vocabularies/xml.js
var builder110 = namespace_default("http://www.w3.org/XML/1998/namespace/");
var strict110 = builder110;

// node_modules/@tpluscode/rdf-ns-builders/index.js
var rdf_ns_builders_default = NsBuildersFactory;

// node_modules/clownface/lib/namespace.js
var namespace_default2 = (factory3) => {
  const xsd4 = factory3.namespace("http://www.w3.org/2001/XMLSchema#");
  const rdf2 = factory3.namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#");
  return {
    first: rdf2.first,
    nil: rdf2.nil,
    rest: rdf2.rest,
    langString: rdf2.langString,
    xsd: xsd4
  };
};

// node_modules/clownface/lib/toArray.js
function toArray(value, defaultValue) {
  if (typeof value === "undefined" || value === null) {
    return defaultValue;
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string" && value[Symbol.iterator]) {
    return [...value];
  }
  return [value];
}

// node_modules/clownface/lib/environment.js
var environment_default = new Environment_default([
  Factory_default3,
  Factory_default
]);

// node_modules/clownface/lib/fromPrimitive.js
var { xsd } = namespace_default2(environment_default);
function booleanToLiteral(value, factory3 = environment_default) {
  if (typeof value !== "boolean") {
    return null;
  }
  return factory3.literal(value.toString(), xsd("boolean"));
}
function numberToLiteral(value, factory3 = environment_default) {
  if (typeof value !== "number") {
    return null;
  }
  if (Number.isInteger(value)) {
    return factory3.literal(value.toString(10), xsd("integer"));
  }
  return factory3.literal(value.toString(10), xsd("double"));
}
function stringToLiteral(value, factory3 = environment_default) {
  if (typeof value !== "string") {
    return null;
  }
  return factory3.literal(value);
}
function toLiteral(value, factory3 = environment_default) {
  return booleanToLiteral(value, factory3) || numberToLiteral(value, factory3) || stringToLiteral(value, factory3);
}

// node_modules/clownface/lib/term.js
function blankNode(value, factory3) {
  if (value && typeof value !== "string") {
    throw new Error("Blank node identifier must be a string");
  }
  return factory3.blankNode(value);
}
function literal(value, languageOrDatatype, factory3) {
  if (typeof value === "string") {
    languageOrDatatype = languageOrDatatype && (languageOrDatatype.value || languageOrDatatype.toString());
    if (languageOrDatatype && languageOrDatatype.indexOf(":") !== -1) {
      languageOrDatatype = factory3.namedNode(languageOrDatatype);
    }
    return factory3.literal(value.toString(), languageOrDatatype);
  }
  const term2 = toLiteral(value, factory3);
  if (!term2) {
    throw new Error("The value cannot be converted to a literal node");
  }
  return term2;
}
function namedNode(value, factory3) {
  if (typeof value !== "string") {
    throw new Error("Named node must be an IRI string");
  }
  return factory3.namedNode(value);
}
function term(value, type = "Literal", languageOrDatatype, factory3) {
  if (value && typeof value === "object" && value.termType) {
    return value;
  }
  if (value && value.constructor.name === "URL") {
    return namedNode(value.toString(), factory3);
  }
  if (type === "BlankNode") {
    return blankNode(value, factory3);
  }
  if (value === null || typeof value === "undefined") {
    return void 0;
  }
  if (type === "Literal") {
    return literal(value, languageOrDatatype, factory3);
  }
  if (type === "NamedNode") {
    return namedNode(value, factory3);
  }
  throw new Error("unknown type");
}

// node_modules/clownface/lib/toTermArray.js
function toTermArray(items, type, languageOrDatatype, factory3) {
  if ((typeof items === "undefined" || items === null) && !type) {
    return items;
  }
  return (toArray(items) || [void 0]).reduce((all, item) => {
    if (typeof item === "object" && item.terms) {
      return all.concat(item.terms);
    }
    all.push(term(item, type, languageOrDatatype, factory3));
    return all;
  }, []);
}

// node_modules/clownface/lib/languageTag.js
var ns = namespace_default2(environment_default);
function mapLiteralsByLanguage(map, current) {
  const notLiteral = current.termType !== "Literal";
  const notStringLiteral = ns.langString.equals(current.datatype) || ns.xsd.string.equals(current.datatype);
  if (notLiteral || !notStringLiteral) return map;
  const language = current.language.toLowerCase();
  if (map.has(language)) {
    map.get(language).push(current);
  } else {
    map.set(language, [current]);
  }
  return map;
}
function createLanguageMapper(objects4) {
  const literalsByLanguage = objects4.reduce(mapLiteralsByLanguage, /* @__PURE__ */ new Map());
  const langMapEntries = [...literalsByLanguage.entries()];
  return (language) => {
    const languageLowerCase = language.toLowerCase();
    if (languageLowerCase === "*") {
      return langMapEntries[0] && langMapEntries[0][1];
    }
    const exactMatch = literalsByLanguage.get(languageLowerCase);
    if (exactMatch) {
      return exactMatch;
    }
    const secondaryMatches = langMapEntries.find(([entryLanguage]) => entryLanguage.startsWith(languageLowerCase));
    return secondaryMatches && secondaryMatches[1];
  };
}
function filterTaggedLiterals(terms, { language }) {
  const languages = typeof language === "string" ? [language] : language;
  const getLiteralsForLanguage = createLanguageMapper(terms);
  return languages.map(getLiteralsForLanguage).find(Boolean) || [];
}

// node_modules/clownface/lib/Context.js
var Context = class _Context {
  constructor({ dataset: dataset2, graph, value, factory: factory3, namespace: namespace2 }) {
    this.dataset = dataset2;
    this.graph = graph;
    this.factory = factory3;
    this.namespace = namespace2;
    this.term = term(value, void 0, void 0, factory3);
  }
  clone({ dataset: dataset2 = this.dataset, graph = this.graph, value, factory: factory3 = this.factory, namespace: namespace2 = this.namespace }) {
    return new _Context({ dataset: dataset2, graph, value, factory: factory3, namespace: namespace2 });
  }
  has(predicate, object) {
    return this.matchProperty(toArray(this.term), predicate, object, toArray(this.graph), "subject").map((subject) => {
      return this.clone({ value: subject });
    });
  }
  in(predicate) {
    return this.matchProperty(null, predicate, toArray(this.term), toArray(this.graph), "subject").map((subject) => {
      return this.clone({ value: subject });
    });
  }
  out(predicate, { language } = {}) {
    let objects4 = this.matchProperty(toArray(this.term), predicate, null, toArray(this.graph), "object");
    if (typeof language !== "undefined") {
      objects4 = filterTaggedLiterals(objects4, { language });
    }
    return objects4.map((object) => {
      return this.clone({ value: object });
    });
  }
  addIn(predicates, subjects) {
    const context2 = [];
    if (this.term) {
      subjects.forEach((subject) => {
        predicates.forEach((predicate) => {
          this.dataset.add(this.factory.quad(subject, predicate, this.term, this.graph));
        });
        context2.push(this.clone({ value: subject }));
      });
    }
    return context2;
  }
  addOut(predicates, objects4) {
    const context2 = [];
    if (this.term) {
      objects4.forEach((object) => {
        predicates.forEach((predicate) => {
          this.dataset.add(this.factory.quad(this.term, predicate, object, this.graph));
        });
        context2.push(this.clone({ value: object }));
      });
    }
    return context2;
  }
  addList(predicates, items) {
    if (!this.term) {
      return;
    }
    predicates.forEach((predicate) => {
      const nodes = items.map(() => this.factory.blankNode());
      this.dataset.add(this.factory.quad(this.term, predicate, nodes[0] || this.namespace.nil, this.graph));
      for (let index = 0; index < nodes.length; index++) {
        this.dataset.add(this.factory.quad(nodes[index], this.namespace.first, items[index], this.graph));
        this.dataset.add(this.factory.quad(nodes[index], this.namespace.rest, nodes[index + 1] || this.namespace.nil, this.graph));
      }
    });
  }
  deleteIn(predicate, subject) {
    this.deleteMatch(subject, predicate, toArray(this.term), toArray(this.graph));
  }
  deleteOut(predicate, objects4) {
    this.deleteMatch(toArray(this.term), predicate, objects4, toArray(this.graph));
  }
  deleteList(predicates) {
    predicates.forEach((predicate) => {
      for (const quad3 of this.dataset.match(this.term, predicate)) {
        this.deleteItems(quad3);
      }
    });
  }
  deleteItems(start) {
    let quads = [start];
    while (!quads[quads.length - 1].object.equals(this.namespace.nil)) {
      const node = quads[quads.length - 1].object;
      quads = quads.concat([...this.dataset.match(node)]);
    }
    quads.forEach((quad3) => {
      this.dataset.delete(quad3);
    });
  }
  match(subject, predicate, object, graph) {
    if (!subject && !predicate && !object && !graph) {
      return [...this.dataset];
    }
    subject = subject || [null];
    predicate = predicate || [null];
    object = object || [null];
    graph = graph || [null];
    const matches = [];
    for (const g of graph) {
      for (const s of subject) {
        for (const p of predicate) {
          for (const o2 of object) {
            for (const quad3 of this.dataset.match(s, p, o2, g)) {
              matches.push(quad3);
            }
          }
        }
      }
    }
    return matches;
  }
  matchProperty(subject, predicate, object, graph, property) {
    return this.match(subject, predicate, object, graph).map((quad3) => quad3[property]);
  }
  deleteMatch(subject, predicate, object, graph) {
    this.match(subject, predicate, object, graph).forEach((quad3) => {
      this.dataset.delete(quad3);
    });
  }
};

// node_modules/clownface/lib/Clownface.js
var Clownface = class _Clownface {
  constructor({ dataset: dataset2, graph, term: term2, value, factory: factory3, _context }) {
    this.factory = factory3;
    this.namespace = namespace_default2(factory3);
    if (_context) {
      this._context = _context;
      return;
    }
    const terms = term2 && toArray(term2) || value && toArray(value) || [null];
    this._context = terms.map((term3) => {
      return new Context({ dataset: dataset2, graph, value: term3, factory: this.factory, namespace: this.namespace });
    });
  }
  /**
   * Gets the current RDF/JS term or undefined if pointer has no context
   *
   * @returns {undefined|Term}
   */
  get term() {
    const terms = this.terms;
    if (terms.length !== 1) {
      return void 0;
    }
    return terms[0];
  }
  /**
   * Gets the current terms or an empty array if the pointer has no context
   *
   * @returns {Term[]}
   */
  get terms() {
    return this._context.map((node) => node.term).filter(Boolean);
  }
  /**
   * Gets the string representation of term
   *
   * @returns {undefined|string}
   */
  get value() {
    const term2 = this.term;
    return term2 && term2.value;
  }
  /**
   * Gets the string representation of terms
   *
   * @returns {string[]}
   */
  get values() {
    return this.terms.map((term2) => term2.value);
  }
  /**
   * Gets the current context's dataset, or undefined if there are multiple
   *
   * @returns {undefined|DatasetCore}
   */
  get dataset() {
    const datasets = this.datasets;
    if (datasets.length !== 1) {
      return void 0;
    }
    return datasets[0];
  }
  /**
   * Gets the current context's datasets
   *
   * @returns {DatasetCore[]}
   */
  get datasets() {
    return this._context.map((node) => node.dataset).filter(Boolean);
  }
  /**
   * Removes current pointers from the context and return an "any pointer".
   * The returned object can be used to find any nodes in the dataset
   *
   * @returns {Clownface}
   */
  any() {
    return _Clownface.fromContext(this._context.map((current) => current.clone({})), this);
  }
  /**
   * Returns true if the current term is a rdf:List
   *
   * @returns {boolean}
   */
  isList() {
    if (!this.term) {
      return false;
    }
    if (this.term.equals(this.namespace.nil)) {
      return true;
    }
    if (this.out(this.namespace.first).term) {
      return true;
    }
    return false;
  }
  /**
   * Creates an iterator which iterates and rdf:List of the current term
   *
   * @returns {Iterable | null}
   */
  list() {
    if (this.terms.length > 1) {
      throw new Error("iterator over multiple terms is not supported");
    }
    if (this.term) {
      if (this.term.termType !== "NamedNode" && this.term.termType !== "BlankNode") {
        return null;
      }
      if (!this.term.equals(this.namespace.nil) && !this.out(this.namespace.first).term) {
        return null;
      }
    }
    let item = this;
    return {
      [Symbol.iterator]: () => {
        return {
          next: () => {
            if (!item.term || item.term.equals(this.namespace.nil)) {
              return { done: true };
            }
            const value = item.out(this.namespace.first);
            if (value.terms.length > 1) {
              throw new Error(`Invalid list: multiple values for rdf:first on ${item.value}`);
            }
            const rest = item.out(this.namespace.rest);
            if (rest.terms.length > 1) {
              throw new Error(`Invalid list: multiple values for rdf:rest on ${item.value}`);
            }
            item = rest;
            return { done: false, value };
          }
        };
      }
    };
  }
  /**
   * Returns an array of graph pointers where each one has a single _context
   *
   * @returns {Clownface[]}
   */
  toArray() {
    return this._context.map((context2) => _Clownface.fromContext(context2, this)).filter((context2) => context2.terms.some(Boolean));
  }
  /**
   * Returns graph pointers which meet the condition specified in a callback function
   * @param {FilterCallback} callback
   * @returns {Clownface}
   */
  filter(callback) {
    const pointers = this._context.map((context2) => _Clownface.fromContext(context2, this));
    return _Clownface.fromContext(this._context.filter((context2, index) => callback(_Clownface.fromContext(context2, this), index, pointers)), this);
  }
  /**
   * Performs the specified action on every graph pointer
   * @param {ForEachCallback} callback
   * @returns {Clownface}
   */
  forEach(callback) {
    this.toArray().forEach(callback);
    return this;
  }
  /**
   * Calls a defined callback function on each graph pointer, and returns an array that contains the results.
   * @template T
   * @param {MapCallback<T>} callback
   * @returns {T[]}
   */
  map(callback) {
    return this.toArray().map(callback);
  }
  toString() {
    return this.values.join();
  }
  /**
   * Creates graph pointer to one or more node(s)
   *
   * Depending on the value creates pointers to:
   *
   * - blank node context for null `values`
   * - literal for string `values` and no `options` paramter
   * - matching RDF/JS term
   * - term created according to `options.type` parameter
   *
   * @param {null|string|string[]|Term|Term[]|Clownface|Clownface[]} values
   * @param {Object} [options]
   * @param {"NamedNode"|"BlankNode"|"Literal"} [options.type] explicit type for nodes
   * @param {string} [options.language] language tag of literals
   * @param {string} [options.datatype] datatype of literals
   * @returns {Clownface}
   */
  node(values2, { type, datatype, language } = {}) {
    values2 = this._toTermArray(values2, type, datatype || language) || [null];
    const context2 = values2.reduce((context3, value) => {
      return context3.concat(this._context.reduce((all, current) => {
        return all.concat([current.clone({ value })]);
      }, []));
    }, []);
    return _Clownface.fromContext(context2, { factory: this.factory });
  }
  /**
   * Creates graph pointer to one or more blank nodes
   * @param {null|string|string[]|BlankNode|BlankNode[]|Clownface|Clownface[]} [values] blank node identifiers (generates it when falsy) or existing RDF/JS blank node(s)
   * @returns {Clownface}
   */
  blankNode(values2) {
    return this.node(values2, { type: "BlankNode" });
  }
  /**
   * Creates graph pointer to one or more literal nodes
   * @param {string|string[]|boolean|boolean[]|number|number[]|Literal|Literal[]|Clownface|Clownface[]} values literal values as JS objects or RDF/JS Literal(s)
   * @param {string|Term} [languageOrDatatype] a language tag string or datatype term
   * @returns {Clownface}
   */
  literal(values2, languageOrDatatype) {
    return this.node(values2, { type: "Literal", datatype: languageOrDatatype });
  }
  /**
   * Creates graph pointer to one or more named nodes
   * @param {string|string[]|NamedNode|NamedNode[]|Clownface|Clownface[]} values URI(s) or RDF/JS NamedNode(s)
   * @returns {Clownface}
   */
  namedNode(values2) {
    return this.node(values2, { type: "NamedNode" });
  }
  /**
   * Creates a graph pointer to nodes which are linked to the current pointer by `predicates`
   * @param {Term|Term[]|Clownface|Clownface[]} [predicates] one or more RDF/JS term identifying a property
   * @returns {Clownface}
   */
  in(predicates) {
    predicates = this._toTermArray(predicates);
    const context2 = this._context.reduce((all, current) => all.concat(current.in(predicates)), []);
    return _Clownface.fromContext(context2, this);
  }
  /**
   * Creates a graph pointer to the result nodes after following a predicate, or after
   * following any predicates in an array, starting from the subject(s) (current graph pointer) to the objects.
   * @param {Term|Term[]|Clownface|Clownface[]} [predicates] any predicates to follow
   * @param {object} [options]
   * @param {string | string[] | undefined} [options.language]
   * @returns {Clownface}
   */
  out(predicates, options = {}) {
    predicates = this._toTermArray(predicates);
    const context2 = this._context.reduce((all, current) => all.concat(current.out(predicates, options)), []);
    return _Clownface.fromContext(context2, this);
  }
  /**
   * Creates a graph pointer to nodes which are subjects of predicates, optionally also with specific objects
   *
   * If the current context is empty, will check all potential subjects
   *
   * @param {Term|Term[]|Clownface|Clownface[]} predicates RDF property identifiers
   * @param {*} [objects] object values to match
   * @returns {Clownface}
   */
  has(predicates, objects4) {
    predicates = this._toTermArray(predicates);
    objects4 = this._toTermArray(objects4);
    const context2 = this._context.reduce((all, current) => all.concat(current.has(predicates, objects4)), []);
    return _Clownface.fromContext(context2, this);
  }
  /**
   * Creates a new quad(s) in the dataset where the current context is the object
   *
   * @param {Term|Term[]|Clownface|Clownface[]} predicates
   * @param {NamedNode|NamedNode[]|Clownface|Clownface[]} subjects one or more nodes to use as subjects
   * @param {GraphPointerCallback} [callback] called for each object, with subject pointer as parameter
   * @returns {Clownface} current graph pointer
   */
  addIn(predicates, subjects, callback) {
    if (!predicates) {
      throw new Error("predicate parameter is required");
    }
    if (typeof subjects === "function") {
      callback = subjects;
      subjects = null;
    }
    predicates = this._toTermArray(predicates);
    subjects = this._toTermArray(subjects) || [this.factory.blankNode()];
    const context2 = this._context.map((context3) => context3.addIn(predicates, subjects));
    if (callback) {
      _Clownface.fromContext(context2, this).forEach(callback);
    }
    return this;
  }
  /**
   * Creates a new quad(s) in the dataset where the current context is the subject
   *
   * @param {Term|Term[]|Clownface|Clownface[]} predicates
   * @param {*} objects one or more values to use for objects
   * @param {GraphPointerCallback} [callback] called for each subject, with object pointer as parameter
   * @returns {Clownface} current graph pointer
   */
  addOut(predicates, objects4, callback) {
    if (!predicates) {
      throw new Error("predicate parameter is required");
    }
    if (typeof objects4 === "function") {
      callback = objects4;
      objects4 = null;
    }
    predicates = this._toTermArray(predicates);
    objects4 = this._toTermArray(objects4) || [this.factory.blankNode()];
    const context2 = this._context.map((context3) => context3.addOut(predicates, objects4));
    if (callback) {
      _Clownface.fromContext(context2, this).forEach(callback);
    }
    return this;
  }
  /**
   * Creates a new RDF list or lists containing the given items
   *
   * @param {Term|Term[]|Clownface|Clownface[]} predicates
   * @param {*} items one or more values to use for subjects
   * @returns {Clownface} current graph pointer
   */
  addList(predicates, items) {
    if (!predicates || !items) {
      throw new Error("predicate and items parameter is required");
    }
    predicates = this._toTermArray(predicates);
    items = this._toTermArray(items);
    this._context.forEach((context2) => context2.addList(predicates, items));
    return this;
  }
  /**
   * Deletes all quads where the current graph pointer contexts are the objects
   *
   * @param {Term|Term[]|Clownface|Clownface[]} [predicates]
   * @param {Term|Term[]|Clownface|Clownface[]} [subjects]
   * @returns {Clownface} current graph pointer
   */
  deleteIn(predicates, subjects) {
    predicates = this._toTermArray(predicates);
    subjects = this._toTermArray(subjects);
    this._context.forEach((context2) => context2.deleteIn(predicates, subjects));
    return this;
  }
  /**
   * Deletes all quads where the current graph pointer contexts are the subjects
   *
   * @param {Term|Term[]|Clownface|Clownface[]} [predicates]
   * @param {Term|Term[]|Clownface|Clownface[]} [objects]
   * @returns {Clownface} current graph pointer
   */
  deleteOut(predicates, objects4) {
    predicates = this._toTermArray(predicates);
    objects4 = this._toTermArray(objects4);
    this._context.forEach((context2) => context2.deleteOut(predicates, objects4));
    return this;
  }
  /**
   * Deletes entire RDF lists where the current graph pointer is the subject
   *
   * @param {Term|Term[]|Clownface|Clownface[]} predicates
   * @returns {Clownface} current graph pointer
   */
  deleteList(predicates) {
    if (!predicates) {
      throw new Error("predicate parameter is required");
    }
    predicates = this._toTermArray(predicates);
    this._context.forEach((context2) => context2.deleteList(predicates));
    return this;
  }
  _toTermArray(predicates, type, languageOrDatatype) {
    return toTermArray(predicates, type, languageOrDatatype, this.factory);
  }
  static fromContext(context2, { factory: factory3 }) {
    return new _Clownface({ _context: toArray(context2), factory: factory3 });
  }
};

// node_modules/clownface/index.js
function factory2({ dataset: dataset2, graph, term: term2, value, factory: factory3 = environment_default, _context }) {
  return new Clownface({ dataset: dataset2, graph, term: term2, value, factory: factory3, _context });
}

// node_modules/clownface/Factory.js
var ClownfaceFactory = class {
  clownface({ ...args } = {}) {
    if (!args.dataset && typeof this.dataset === "function") {
      args.dataset = this.dataset();
    }
    return factory2({ ...args, factory: this });
  }
};
ClownfaceFactory.exports = ["clownface"];
var Factory_default4 = ClownfaceFactory;

// node_modules/@rdfjs/to-ntriples/lib/blankNode.js
function blankNode2(blankNode4) {
  return "_:" + blankNode4.value;
}
var blankNode_default = blankNode2;

// node_modules/@rdfjs/to-ntriples/lib/dataset.js
function dataset(dataset2, toNT2) {
  return [...dataset2].map((quad3) => toNT2(quad3)).join("\n") + "\n";
}
var dataset_default = dataset;

// node_modules/@rdfjs/to-ntriples/lib/defaultGraph.js
function defaultGraph() {
  return "";
}
var defaultGraph_default = defaultGraph;

// node_modules/@rdfjs/to-ntriples/lib/namedNode.js
function namedNode2(namedNode4) {
  return "<" + namedNode4.value + ">";
}
var namedNode_default = namedNode2;

// node_modules/@rdfjs/to-ntriples/lib/literal.js
var echarRegEx = /["\\\\\n\r]/;
var echarRegExAll = /["\\\\\n\r]/g;
var echarReplacement = {
  '"': '\\"',
  "\\": "\\\\",
  "\n": "\\n",
  "\r": "\\r"
};
function echarReplacer(char) {
  return echarReplacement[char];
}
function escapeValue(value) {
  if (echarRegEx.test(value)) {
    return value.replace(echarRegExAll, echarReplacer);
  }
  return value;
}
function literal2(literal4) {
  const escapedValue = escapeValue(literal4.value);
  if (literal4.datatype.value === "http://www.w3.org/2001/XMLSchema#string") {
    return '"' + escapedValue + '"';
  }
  if (literal4.datatype.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString") {
    return '"' + escapedValue + '"@' + literal4.language;
  }
  return '"' + escapedValue + '"^^' + namedNode_default(literal4.datatype);
}
var literal_default = literal2;

// node_modules/@rdfjs/to-ntriples/lib/quad.js
function quad(quad3, toNT2) {
  const subjectString = toNT2(quad3.subject);
  const predicateString = toNT2(quad3.predicate);
  const objectString = toNT2(quad3.object);
  const graphString = toNT2(quad3.graph);
  return `${subjectString} ${predicateString} ${objectString} ${graphString ? graphString + " " : ""}.`;
}
var quad_default = quad;

// node_modules/@rdfjs/to-ntriples/lib/variable.js
function variable(variable3) {
  return "?" + variable3.value;
}
var variable_default = variable;

// node_modules/@rdfjs/to-ntriples/index.js
function toNT(term2) {
  if (!term2) {
    return null;
  }
  if (term2.termType === "BlankNode") {
    return blankNode_default(term2);
  }
  if (term2.termType === "DefaultGraph") {
    return defaultGraph_default();
  }
  if (term2.termType === "Literal") {
    return literal_default(term2);
  }
  if (term2.termType === "NamedNode") {
    return namedNode_default(term2);
  }
  if (term2.termType === "Quad" || term2.subject && term2.predicate && term2.object && term2.graph) {
    return quad_default(term2, toNT);
  }
  if (term2.termType === "Variable") {
    return variable_default(term2);
  }
  if (term2[Symbol.iterator]) {
    return dataset_default(term2, toNT);
  }
  throw new Error(`unknown termType ${term2.termType}`);
}
var to_ntriples_default = toNT;

// node_modules/@rdfjs/term-map/TermMap.js
var TermMap = class {
  constructor(entries2) {
    this.index = /* @__PURE__ */ new Map();
    if (entries2) {
      for (const [term2, value] of entries2) {
        this.set(term2, value);
      }
    }
  }
  get size() {
    return this.index.size;
  }
  clear() {
    this.index.clear();
  }
  delete(term2) {
    return this.index.delete(to_ntriples_default(term2));
  }
  *entries() {
    for (const [, { term: term2, value }] of this.index) {
      yield [term2, value];
    }
  }
  forEach(callback, thisArg) {
    for (const entry of this.entries()) {
      callback.call(thisArg, entry[1], entry[0], this);
    }
  }
  get(term2) {
    const item = this.index.get(to_ntriples_default(term2));
    return item && item.value;
  }
  has(term2) {
    return this.index.has(to_ntriples_default(term2));
  }
  *keys() {
    for (const [, { term: term2 }] of this.index) {
      yield term2;
    }
  }
  set(term2, value) {
    const key = to_ntriples_default(term2);
    this.index.set(key, { term: term2, value });
    return this;
  }
  *values() {
    for (const [, { value }] of this.index) {
      yield value;
    }
  }
  [Symbol.iterator]() {
    return this.entries()[Symbol.iterator]();
  }
};
var TermMap_default = TermMap;

// node_modules/@rdfjs/term-map/Factory.js
var Factory3 = class {
  termMap(entries2) {
    return new TermMap_default(entries2);
  }
};
Factory3.exports = ["termMap"];
var Factory_default5 = Factory3;

// node_modules/@rdfjs/term-set/TermSet.js
function quietToNT(term2) {
  try {
    return to_ntriples_default(term2);
  } catch (err) {
    return null;
  }
}
var TermSet = class {
  constructor(terms) {
    this.index = /* @__PURE__ */ new Map();
    if (terms) {
      for (const term2 of terms) {
        this.add(term2);
      }
    }
  }
  get size() {
    return this.index.size;
  }
  add(term2) {
    const key = to_ntriples_default(term2);
    if (!this.index.has(key)) {
      this.index.set(key, term2);
    }
    return this;
  }
  clear() {
    this.index.clear();
  }
  delete(term2) {
    if (!term2) {
      return false;
    }
    return this.index.delete(quietToNT(term2));
  }
  entries() {
    return this.values().entries();
  }
  forEach(callbackfn, thisArg) {
    return this.values().forEach(callbackfn, thisArg);
  }
  has(term2) {
    if (!term2) {
      return false;
    }
    return this.index.has(quietToNT(term2));
  }
  values() {
    return new Set(this.index.values());
  }
  keys() {
    return this.values();
  }
  [Symbol.iterator]() {
    return this.index.values();
  }
};
var TermSet_default = TermSet;

// node_modules/@rdfjs/term-set/Factory.js
var Factory4 = class {
  termSet(terms) {
    return new TermSet_default(terms);
  }
};
Factory4.exports = ["termSet"];
var Factory_default6 = Factory4;

// node_modules/@rdfjs/traverser/Traverser.js
var Visisted = class {
  constructor() {
    this.quadLevel = /* @__PURE__ */ new Map();
  }
  add(quad3, level) {
    this.quadLevel.set(to_ntriples_default(quad3), level);
  }
  has(quad3, level) {
    const seenAt = this.quadLevel.get(to_ntriples_default(quad3));
    if (seenAt === void 0) {
      return false;
    }
    return seenAt <= level;
  }
};
function forEach({ backward, callback, dataset: dataset2, filter, forward, term: term2, visited = new Visisted() }) {
  const next = (term3, level) => {
    const checkMatches = (matches) => {
      for (const quad3 of matches) {
        if (visited.has(quad3, level)) {
          continue;
        }
        visited.add(quad3, level);
        const args = { dataset: dataset2, level, quad: quad3 };
        if (filter(args)) {
          callback(args);
          if (forward) {
            next(quad3.object, level + 1);
          }
          if (backward) {
            next(quad3.subject, level + 1);
          }
        }
      }
    };
    if (forward) {
      checkMatches(dataset2.match(term3));
    }
    if (backward) {
      checkMatches(dataset2.match(null, null, term3));
    }
  };
  next(term2, 0);
}
var Traverser = class {
  constructor(filter, { backward = false, factory: factory3, forward = true }) {
    this.backward = backward;
    this.factory = factory3;
    this.filter = filter;
    this.forward = forward;
  }
  forEach({ term: term2, dataset: dataset2 }, callback) {
    forEach({
      backward: this.backward,
      callback,
      dataset: dataset2,
      filter: this.filter,
      forward: this.forward,
      term: term2
    });
  }
  match({ term: term2, dataset: dataset2 }) {
    const result = this.factory.dataset();
    forEach({
      backward: this.backward,
      callback: ({ quad: quad3 }) => result.add(quad3),
      dataset: dataset2,
      filter: this.filter,
      forward: this.forward,
      term: term2
    });
    return result;
  }
  reduce({ term: term2, dataset: dataset2 }, callback, initialValue) {
    let result = initialValue;
    forEach({
      backward: this.backward,
      callback: (args) => {
        result = callback(args, result);
      },
      dataset: dataset2,
      filter: this.filter,
      forward: this.forward,
      term: term2
    });
    return result;
  }
};
var Traverser_default = Traverser;

// node_modules/@rdfjs/traverser/Factory.js
var Factory5 = class {
  traverser(filter, { backward = false, forward = true } = {}) {
    return new Traverser_default(filter, { backward, factory: this, forward });
  }
};
Factory5.exports = ["traverser"];
var Factory_default7 = Factory5;

// node_modules/@zazuko/env/lib/env-no-dataset.js
var env_no_dataset_default = new Environment_default2([
  Factory_default,
  Factory_default2,
  Factory_default3,
  rdf_ns_builders_default,
  Factory_default4,
  Factory_default5,
  Factory_default6,
  Factory_default7
]);

// node_modules/@zazuko/env/lib/DatasetExt.js
var import_toCanonical3 = __toESM(require_toCanonical(), 1);
var import_toStream3 = __toESM(require_toStream(), 1);
var import_fromStream2 = __toESM(require_fromStream(), 1);

// node_modules/@rdfjs/dataset/DatasetCore.js
function isString(s) {
  return typeof s === "string" || s instanceof String;
}
var xsdString = "http://www.w3.org/2001/XMLSchema#string";
function termToId(term2) {
  if (typeof term2 === "string") {
    return term2;
  }
  if (!term2) {
    return "";
  }
  if (typeof term2.id !== "undefined" && term2.termType !== "Quad") {
    return term2.id;
  }
  let subject, predicate, object, graph;
  switch (term2.termType) {
    case "NamedNode":
      return term2.value;
    case "BlankNode":
      return `_:${term2.value}`;
    case "Variable":
      return `?${term2.value}`;
    case "DefaultGraph":
      return "";
    case "Literal":
      if (term2.language) {
        return `"${term2.value}"@${term2.language}${term2.direction ? `--${term2.direction}` : ""}`;
      }
      return `"${term2.value}"${term2.datatype && term2.datatype.value !== xsdString ? `^^${term2.datatype.value}` : ""}`;
    case "Quad":
      subject = escapeQuotes(termToId(term2.subject));
      predicate = escapeQuotes(termToId(term2.predicate));
      object = escapeQuotes(termToId(term2.object));
      graph = term2.graph.termType === "DefaultGraph" ? "" : ` ${termToId(term2.graph)}`;
      return `<<${subject} ${predicate} ${object}${graph}>>`;
    default:
      throw new Error(`Unexpected termType: ${term2.termType}`);
  }
}
var escapedLiteral = /^"(.*".*)(?="[^"]*$)/;
function escapeQuotes(id) {
  return id.replace(escapedLiteral, (_, quoted) => `"${quoted.replace(/"/g, '""')}`);
}
var DatasetCore = class {
  constructor(quads) {
    this._size = 0;
    this._graphs = /* @__PURE__ */ Object.create(null);
    this._id = 0;
    this._ids = /* @__PURE__ */ Object.create(null);
    this._ids["><"] = 0;
    this._entities = /* @__PURE__ */ Object.create(null);
    this._quads = /* @__PURE__ */ new Map();
    if (quads) {
      for (const quad3 of quads) {
        this.add(quad3);
      }
    }
  }
  get size() {
    let size = this._size;
    if (size !== null) {
      return size;
    }
    size = 0;
    const graphs = this._graphs;
    let subjects, subject;
    for (const graphKey in graphs) {
      for (const subjectKey in subjects = graphs[graphKey].subjects) {
        for (const predicateKey in subject = subjects[subjectKey]) {
          size += Object.keys(subject[predicateKey]).length;
        }
      }
    }
    this._size = size;
    return this._size;
  }
  add(quad3) {
    let subject = termToId(quad3.subject);
    let predicate = termToId(quad3.predicate);
    let object = termToId(quad3.object);
    const graph = termToId(quad3.graph);
    let graphItem = this._graphs[graph];
    if (!graphItem) {
      graphItem = this._graphs[graph] = { subjects: {}, predicates: {}, objects: {} };
      Object.freeze(graphItem);
    }
    const ids = this._ids;
    const entities = this._entities;
    subject = ids[subject] || (ids[entities[++this._id] = subject] = this._id);
    predicate = ids[predicate] || (ids[entities[++this._id] = predicate] = this._id);
    object = ids[object] || (ids[entities[++this._id] = object] = this._id);
    this._addToIndex(graphItem.subjects, subject, predicate, object);
    this._addToIndex(graphItem.predicates, predicate, object, subject);
    this._addToIndex(graphItem.objects, object, subject, predicate);
    this._setQuad(subject, predicate, object, graph, quad3);
    this._size = null;
    return this;
  }
  delete(quad3) {
    let subject = termToId(quad3.subject);
    let predicate = termToId(quad3.predicate);
    let object = termToId(quad3.object);
    const graph = termToId(quad3.graph);
    const ids = this._ids;
    const graphs = this._graphs;
    let graphItem, subjects, predicates;
    if (!(subject = ids[subject]) || !(predicate = ids[predicate]) || !(object = ids[object]) || !(graphItem = graphs[graph]) || !(subjects = graphItem.subjects[subject]) || !(predicates = subjects[predicate]) || !(object in predicates)) {
      return this;
    }
    this._removeFromIndex(graphItem.subjects, subject, predicate, object);
    this._removeFromIndex(graphItem.predicates, predicate, object, subject);
    this._removeFromIndex(graphItem.objects, object, subject, predicate);
    if (this._size !== null) {
      this._size--;
    }
    this._deleteQuad(subject, predicate, object, graph);
    for (subject in graphItem.subjects) {
      return this;
    }
    delete graphs[graph];
    return this;
  }
  has(quad3) {
    const subject = termToId(quad3.subject);
    const predicate = termToId(quad3.predicate);
    const object = termToId(quad3.object);
    const graph = termToId(quad3.graph);
    const graphItem = this._graphs[graph];
    if (!graphItem) {
      return false;
    }
    const ids = this._ids;
    let subjectId, predicateId, objectId;
    if (isString(subject) && !(subjectId = ids[subject]) || isString(predicate) && !(predicateId = ids[predicate]) || isString(object) && !(objectId = ids[object])) {
      return false;
    }
    return this._countInIndex(graphItem.objects, objectId, subjectId, predicateId) === 1;
  }
  match(subject, predicate, object, graph) {
    return this._createDataset(this._match(subject, predicate, object, graph));
  }
  [Symbol.iterator]() {
    return this._match()[Symbol.iterator]();
  }
  // ## Private methods
  // ### `_addToIndex` adds a quad to a three-layered index.
  // Returns if the index has changed, if the entry did not already exist.
  _addToIndex(index0, key0, key1, key2) {
    const index1 = index0[key0] || (index0[key0] = {});
    const index2 = index1[key1] || (index1[key1] = {});
    const existed = key2 in index2;
    if (!existed) {
      index2[key2] = null;
    }
    return !existed;
  }
  // ### `_removeFromIndex` removes a quad from a three-layered index
  _removeFromIndex(index0, key0, key1, key2) {
    const index1 = index0[key0];
    const index2 = index1[key1];
    delete index2[key2];
    for (const key in index2) {
      return;
    }
    delete index1[key1];
    for (const key in index1) {
      return;
    }
    delete index0[key0];
  }
  // ### `_findInIndex` finds a set of quads in a three-layered index.
  // The index base is `index0` and the keys at each level are `key0`, `key1`, and `key2`.
  // Any of these keys can be undefined, which is interpreted as a wildcard.
  // `name0`, `name1`, and `name2` are the names of the keys at each level,
  // used when reconstructing the resulting quad
  // (for instance: _subject_, _predicate_, and _object_).
  // Finally, `graph` will be the graph of the created quads.
  // If `callback` is given, each result is passed through it
  // and iteration halts when it returns truthy for any quad.
  // If instead `array` is given, each result is added to the array.
  _findInIndex(index0, key0, key1, key2, name0, name1, name2, graph, callback, array) {
    let tmp, index1, index2;
    if (key0) {
      (tmp = index0, index0 = {})[key0] = tmp[key0];
    }
    for (const value0 in index0) {
      index1 = index0[value0];
      if (index1) {
        if (key1) {
          (tmp = index1, index1 = {})[key1] = tmp[key1];
        }
        for (const value1 in index1) {
          index2 = index1[value1];
          if (index2) {
            const values2 = key2 ? key2 in index2 ? [key2] : [] : Object.keys(index2);
            for (let l = 0; l < values2.length; l++) {
              const parts = {
                [name0]: value0,
                [name1]: value1,
                [name2]: values2[l]
              };
              const quad3 = this._getQuad(parts.subject, parts.predicate, parts.object, graph);
              if (array) {
                array.push(quad3);
              } else if (callback(quad3)) {
                return true;
              }
            }
          }
        }
      }
    }
    return array;
  }
  // ### `_countInIndex` counts matching quads in a three-layered index.
  // The index base is `index0` and the keys at each level are `key0`, `key1`, and `key2`.
  // Any of these keys can be undefined, which is interpreted as a wildcard.
  _countInIndex(index0, key0, key1, key2) {
    let count = 0;
    let tmp, index1, index2;
    if (key0) {
      (tmp = index0, index0 = {})[key0] = tmp[key0];
    }
    for (const value0 in index0) {
      index1 = index0[value0];
      if (index1) {
        if (key1) {
          (tmp = index1, index1 = {})[key1] = tmp[key1];
        }
        for (const value1 in index1) {
          index2 = index1[value1];
          if (index2) {
            if (key2) {
              key2 in index2 && count++;
            } else {
              count += Object.keys(index2).length;
            }
          }
        }
      }
    }
    return count;
  }
  // ### `_getGraphs` returns an array with the given graph,
  // or all graphs if the argument is null or undefined.
  _getGraphs(graph) {
    if (!isString(graph)) {
      return this._graphs;
    }
    return {
      [graph]: this._graphs[graph]
    };
  }
  _match(subject, predicate, object, graph) {
    subject = subject && termToId(subject);
    predicate = predicate && termToId(predicate);
    object = object && termToId(object);
    graph = graph && termToId(graph);
    const quads = [];
    const graphs = this._getGraphs(graph);
    const ids = this._ids;
    let content, subjectId, predicateId, objectId;
    if (isString(subject) && !(subjectId = ids[subject]) || isString(predicate) && !(predicateId = ids[predicate]) || isString(object) && !(objectId = ids[object])) {
      return quads;
    }
    for (const graphId in graphs) {
      content = graphs[graphId];
      if (content) {
        if (subjectId) {
          if (objectId) {
            this._findInIndex(content.objects, objectId, subjectId, predicateId, "object", "subject", "predicate", graphId, null, quads);
          } else {
            this._findInIndex(content.subjects, subjectId, predicateId, null, "subject", "predicate", "object", graphId, null, quads);
          }
        } else if (predicateId) {
          this._findInIndex(content.predicates, predicateId, objectId, null, "predicate", "object", "subject", graphId, null, quads);
        } else if (objectId) {
          this._findInIndex(content.objects, objectId, null, null, "object", "subject", "predicate", graphId, null, quads);
        } else {
          this._findInIndex(content.subjects, null, null, null, "subject", "predicate", "object", graphId, null, quads);
        }
      }
    }
    return quads;
  }
  _getQuad(subjectId, predicateId, objectId, graphId) {
    return this._quads.get(this._toId(subjectId, predicateId, objectId, graphId));
  }
  _setQuad(subjectId, predicateId, objectId, graphId, quad3) {
    this._quads.set(this._toId(subjectId, predicateId, objectId, graphId), quad3);
  }
  _deleteQuad(subjectId, predicateId, objectId, graphId) {
    this._quads.delete(this._toId(subjectId, predicateId, objectId, graphId));
  }
  _createDataset(quads) {
    return new this.constructor(quads);
  }
  _toId(subjectId, predicateId, objectId, graphId) {
    return `${subjectId}:${predicateId}:${objectId}:${graphId}`;
  }
};
var DatasetCore_default = DatasetCore;

// node_modules/@zazuko/env/lib/Dataset.js
var import_addAll3 = __toESM(require_addAll(), 1);
var import_deleteMatch2 = __toESM(require_deleteMatch(), 1);
var import_equals2 = __toESM(require_equals(), 1);
var Dataset = class extends DatasetCore_default {
  addAll(...[quads]) {
    return (0, import_addAll3.default)(this, quads);
  }
  deleteMatches(...args) {
    return (0, import_deleteMatch2.default)(this, ...args);
  }
  equals(...[other]) {
    return (0, import_equals2.default)(this, other);
  }
  forEach(callback) {
    Array.from(this).forEach((quad3) => callback(quad3, this));
  }
  filter(filter) {
    return new this.constructor([...this].filter((quad3) => filter(quad3, this)));
  }
  map(callback) {
    return new this.constructor([...this].map((quad3) => callback(quad3, this)));
  }
  match(...args) {
    return super.match(...args);
  }
  merge(...[other]) {
    return (0, import_addAll3.default)(new this.constructor([...this]), other);
  }
};

// node_modules/@zazuko/env/lib/DatasetExt.js
function createConstructor(env) {
  return class extends Dataset {
    import(...[stream]) {
      return (0, import_fromStream2.default)(this, stream);
    }
    toCanonical() {
      return (0, import_toCanonical3.default)(this);
    }
    toStream() {
      return (0, import_toStream3.default)(this);
    }
    async serialize(args) {
      return serialize(env, this, args);
    }
  };
}

// node_modules/@zazuko/env/index.js
function create() {
  return new Environment_default2([DatasetFactoryExt_default(createConstructor)], { parent: env_no_dataset_default });
}
var env_default = create();

// src/rdf/Vocabulary.js
var JIG = "http://purl.org/stuff/jigdaw/";
var TRN = "http://purl.org/stuff/transmissions/";
var LV2 = "http://lv2plug.in/ns/lv2core#";
var MIDI = "http://lv2plug.in/ns/ext/midi#";
var UNITS = "http://lv2plug.in/ns/extensions/units#";
var PPROPS = "http://lv2plug.in/ns/ext/port-props#";
var RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
var RDFS = "http://www.w3.org/2000/01/rdf-schema#";
var FOAF = "http://xmlns.com/foaf/0.1/";
var DCTERMS = "http://purl.org/dc/terms/";
var DOAP = "http://usefulinc.com/ns/doap#";
var PROV = "http://www.w3.org/ns/prov#";
var SEC = "https://w3id.org/security#";
var vocabulary = Object.freeze({
  rdf: Object.freeze({
    type: `${RDF}type`,
    value: `${RDF}value`
  }),
  rdfs: Object.freeze({
    label: `${RDFS}label`,
    comment: `${RDFS}comment`
  }),
  foaf: Object.freeze({
    homepage: `${FOAF}homepage`,
    name: `${FOAF}name`
  }),
  dcterms: Object.freeze({
    created: `${DCTERMS}created`,
    modified: `${DCTERMS}modified`,
    creator: `${DCTERMS}creator`,
    // A collection's members. docs/plugin-collections.md.
    hasPart: `${DCTERMS}hasPart`
  }),
  // A plugin's version and its developer. DOAP rather than jig: terms, because
  // LV2 describes a plugin project with DOAP and this vocabulary already
  // follows LV2. doap:developer is an IRI, never a name, the same rule
  // provenance attribution already follows: a name is not something anything
  // can be checked against.
  doap: Object.freeze({
    revision: `${DOAP}revision`,
    developer: `${DOAP}developer`
  }),
  // Provenance. Reused unchanged: who made a bundle, when, and from what.
  prov: Object.freeze({
    Agent: `${PROV}Agent`,
    SoftwareAgent: `${PROV}SoftwareAgent`,
    used: `${PROV}used`,
    atLocation: `${PROV}atLocation`,
    endedAtTime: `${PROV}endedAtTime`,
    wasDerivedFrom: `${PROV}wasDerivedFrom`,
    wasGeneratedBy: `${PROV}wasGeneratedBy`,
    wasAssociatedWith: `${PROV}wasAssociatedWith`,
    wasAttributedTo: `${PROV}wasAttributedTo`
  }),
  // Signatures. The W3C security vocabulary, which is what Data Integrity
  // proofs and Multikey are already expressed in. Inventing a jig: parallel to
  // sec:proofValue would be a second answer to a question with a standard one.
  sec: Object.freeze({
    DataIntegrityProof: `${SEC}DataIntegrityProof`,
    Multikey: `${SEC}Multikey`,
    proof: `${SEC}proof`,
    proofValue: `${SEC}proofValue`,
    proofPurpose: `${SEC}proofPurpose`,
    assertionMethod: `${SEC}assertionMethod`,
    cryptosuite: `${SEC}cryptosuite`,
    verificationMethod: `${SEC}verificationMethod`,
    publicKeyMultibase: `${SEC}publicKeyMultibase`
  }),
  // Musical semantics. Reused unchanged; never redefined here.
  trn: Object.freeze({
    PluginProfile: `${TRN}PluginProfile`,
    role: `${TRN}role`,
    accepts: `${TRN}accepts`,
    produces: `${TRN}produces`,
    requires: `${TRN}requires`,
    recommendedBefore: `${TRN}recommendedBefore`,
    recommendedAfter: `${TRN}recommendedAfter`,
    companion: `${TRN}companion`,
    genre: `${TRN}genre`,
    caution: `${TRN}caution`,
    vendor: `${TRN}vendor`,
    format: `${TRN}format`,
    HostTransport: `${TRN}HostTransport`,
    Audio: `${TRN}Audio`,
    Midi: `${TRN}Midi`,
    // MIDI that reshapes a plugin rather than playing it. ControlMidi covers
    // CCs and scene notes; MidiCC is the narrower CCs-alone term. Both are
    // upstream-defined in plugin-universe's vocabs/trn-profile.ttl.
    ControlMidi: `${TRN}ControlMidi`,
    MidiCC: `${TRN}MidiCC`,
    // A clip's and a note's placement, and a note itself. transmission's
    // arrangement terms, reused for the same purpose.
    startBeat: `${TRN}startBeat`,
    lengthBeats: `${TRN}lengthBeats`,
    pitch: `${TRN}pitch`,
    velocity: `${TRN}velocity`
  }),
  jig: Object.freeze({
    WebPlugin: `${JIG}WebPlugin`,
    Resource: `${JIG}Resource`,
    Module: `${JIG}Module`,
    Processor: `${JIG}Processor`,
    UserInterface: `${JIG}UserInterface`,
    // Skins: a declarative interface, artwork plus bindings (docs/svg-skins.md)
    Skin: `${JIG}Skin`,
    Artwork: `${JIG}Artwork`,
    Control: `${JIG}Control`,
    RotaryControl: `${JIG}RotaryControl`,
    LinearControl: `${JIG}LinearControl`,
    ToggleControl: `${JIG}ToggleControl`,
    SelectorControl: `${JIG}SelectorControl`,
    ReadoutControl: `${JIG}ReadoutControl`,
    skin: `${JIG}skin`,
    artwork: `${JIG}artwork`,
    control: `${JIG}control`,
    boundSymbol: `${JIG}boundSymbol`,
    element: `${JIG}element`,
    hitElement: `${JIG}hitElement`,
    pivotElement: `${JIG}pivotElement`,
    trackElement: `${JIG}trackElement`,
    angleMin: `${JIG}angleMin`,
    angleMax: `${JIG}angleMax`,
    // Delivery
    module: `${JIG}module`,
    processor: `${JIG}processor`,
    ui: `${JIG}ui`,
    asset: `${JIG}asset`,
    location: `${JIG}location`,
    integrity: `${JIG}integrity`,
    mediaType: `${JIG}mediaType`,
    registeredName: `${JIG}registeredName`,
    wasmFeature: `${JIG}wasmFeature`,
    userReplaceable: `${JIG}userReplaceable`,
    maxBytes: `${JIG}maxBytes`,
    ModuleAbi: `${JIG}ModuleAbi`,
    Abi1: `${JIG}Abi1`,
    Abi2: `${JIG}Abi2`,
    abi: `${JIG}abi`,
    paramIndex: `${JIG}paramIndex`,
    Simd128: `${JIG}Simd128`,
    Threads: `${JIG}Threads`,
    BulkMemory: `${JIG}BulkMemory`,
    ExceptionHandling: `${JIG}ExceptionHandling`,
    // Capabilities
    prefers: `${JIG}prefers`,
    SharedMemory: `${JIG}SharedMemory`,
    CrossOriginIsolation: `${JIG}CrossOriginIsolation`,
    MidiEvents: `${JIG}MidiEvents`,
    MidiOut: `${JIG}MidiOut`,
    OfflineRender: `${JIG}OfflineRender`,
    Persistence: `${JIG}Persistence`,
    // Runtime shape
    audioInputs: `${JIG}audioInputs`,
    sidechainInput: `${JIG}sidechainInput`,
    stateless: `${JIG}stateless`,
    audioOutputs: `${JIG}audioOutputs`,
    inputChannels: `${JIG}inputChannels`,
    outputChannels: `${JIG}outputChannels`,
    renderQuantum: `${JIG}renderQuantum`,
    latencyFrames: `${JIG}latencyFrames`,
    tailFrames: `${JIG}tailFrames`,
    // Parameters
    automationRate: `${JIG}automationRate`,
    ARate: `${JIG}ARate`,
    KRate: `${JIG}KRate`,
    // The panel section a control belongs under. A plain label: groups are
    // per-plugin display hints, never addressed across documents.
    controlGroup: `${JIG}controlGroup`,
    // A two-axis pad over two ports (docs/plugin-profiles.md, "A pad for two controls").
    ControlPad: `${JIG}ControlPad`,
    pad: `${JIG}pad`,
    padX: `${JIG}padX`,
    padY: `${JIG}padY`,
    padXLow: `${JIG}padXLow`,
    padXHigh: `${JIG}padXHigh`,
    padYLow: `${JIG}padYLow`,
    padYHigh: `${JIG}padYHigh`,
    padChoice: `${JIG}padChoice`,
    // Projects
    Project: `${JIG}Project`,
    Track: `${JIG}Track`,
    Node: `${JIG}Node`,
    Connection: `${JIG}Connection`,
    Endpoint: `${JIG}Endpoint`,
    ParameterSetting: `${JIG}ParameterSetting`,
    Transport: `${JIG}Transport`,
    TempoPoint: `${JIG}TempoPoint`,
    revision: `${JIG}revision`,
    node: `${JIG}node`,
    track: `${JIG}track`,
    connection: `${JIG}connection`,
    transport: `${JIG}transport`,
    plugin: `${JIG}plugin`,
    nodeState: `${JIG}nodeState`,
    gain: `${JIG}gain`,
    pan: `${JIG}pan`,
    muted: `${JIG}muted`,
    soloed: `${JIG}soloed`,
    onTrack: `${JIG}onTrack`,
    midiInput: `${JIG}midiInput`,
    audioInput: `${JIG}audioInput`,
    armed: `${JIG}armed`,
    recordSource: `${JIG}recordSource`,
    Clip: `${JIG}Clip`,
    MidiClip: `${JIG}MidiClip`,
    AudioClip: `${JIG}AudioClip`,
    Note: `${JIG}Note`,
    ControllerEvent: `${JIG}ControllerEvent`,
    PitchBendEvent: `${JIG}PitchBendEvent`,
    controllerEvent: `${JIG}controllerEvent`,
    loopBeats: `${JIG}loopBeats`,
    chance: `${JIG}chance`,
    scene: `${JIG}scene`,
    controller: `${JIG}controller`,
    bend: `${JIG}bend`,
    clip: `${JIG}clip`,
    note: `${JIG}note`,
    source: `${JIG}source`,
    offsetSeconds: `${JIG}offsetSeconds`,
    locked: `${JIG}locked`,
    bypassed: `${JIG}bypassed`,
    fadeInBeats: `${JIG}fadeInBeats`,
    fadeOutBeats: `${JIG}fadeOutBeats`,
    setting: `${JIG}setting`,
    from: `${JIG}from`,
    to: `${JIG}to`,
    signalKind: `${JIG}signalKind`,
    endpointNode: `${JIG}endpointNode`,
    portIndex: `${JIG}portIndex`,
    portSymbol: `${JIG}portSymbol`,
    symbol: `${JIG}symbol`,
    value: `${JIG}value`,
    tempoPoint: `${JIG}tempoPoint`,
    atBeat: `${JIG}atBeat`,
    bpm: `${JIG}bpm`,
    beatsPerBar: `${JIG}beatsPerBar`,
    beatUnit: `${JIG}beatUnit`,
    loopStart: `${JIG}loopStart`,
    loopEnd: `${JIG}loopEnd`,
    loopEnabled: `${JIG}loopEnabled`,
    alignTracks: `${JIG}alignTracks`,
    launchQuantise: `${JIG}launchQuantise`,
    Master: `${JIG}Master`,
    master: `${JIG}master`,
    Send: `${JIG}Send`,
    send: `${JIG}send`,
    sendFrom: `${JIG}sendFrom`,
    sendTo: `${JIG}sendTo`,
    level: `${JIG}level`,
    tap: `${JIG}tap`,
    lowNote: `${JIG}lowNote`,
    highNote: `${JIG}highNote`,
    PreFader: `${JIG}PreFader`,
    PostFader: `${JIG}PostFader`,
    output: `${JIG}output`,
    Marker: `${JIG}Marker`,
    marker: `${JIG}marker`,
    Region: `${JIG}Region`,
    region: `${JIG}region`,
    SignaturePoint: `${JIG}SignaturePoint`,
    signaturePoint: `${JIG}signaturePoint`,
    Envelope: `${JIG}Envelope`,
    envelope: `${JIG}envelope`,
    targetNode: `${JIG}targetNode`,
    targetSymbol: `${JIG}targetSymbol`,
    targetKind: `${JIG}targetKind`,
    MasterGain: `${JIG}MasterGain`,
    MasterPan: `${JIG}MasterPan`,
    Tempo: `${JIG}Tempo`,
    EnvelopePoint: `${JIG}EnvelopePoint`,
    envelopePoint: `${JIG}envelopePoint`,
    pointValue: `${JIG}pointValue`,
    curve: `${JIG}curve`,
    Step: `${JIG}Step`,
    Linear: `${JIG}Linear`,
    Smooth: `${JIG}Smooth`,
    x: `${JIG}x`,
    y: `${JIG}y`,
    order: `${JIG}order`,
    color: `${JIG}color`,
    laneSize: `${JIG}laneSize`,
    laneHeight: `${JIG}laneHeight`,
    folder: `${JIG}folder`,
    folderCollapsed: `${JIG}folderCollapsed`,
    // Scripts saved with a session. docs/project-format.md.
    Script: `${JIG}Script`,
    ScriptLanguage: `${JIG}ScriptLanguage`,
    Reel: `${JIG}Reel`,
    scriptLanguage: `${JIG}scriptLanguage`,
    scriptSource: `${JIG}scriptSource`,
    // Foreign plugins. Contract section 12.
    ForeignPlugin: `${JIG}ForeignPlugin`,
    ForeignFormat: `${JIG}ForeignFormat`,
    WebAudioModule: `${JIG}WebAudioModule`,
    foreignFormat: `${JIG}foreignFormat`,
    container: `${JIG}container`,
    entryPoint: `${JIG}entryPoint`,
    // Collections. docs/plugin-collections.md.
    PluginCollection: `${JIG}PluginCollection`,
    // Nested plugins. docs/nested-plugins.md.
    CompositePlugin: `${JIG}CompositePlugin`,
    Member: `${JIG}Member`,
    member: `${JIG}member`,
    pinnedDigest: `${JIG}pinnedDigest`,
    drives: `${JIG}drives`,
    // Bundles and provenance
    Bundle: `${JIG}Bundle`,
    Bundling: `${JIG}Bundling`,
    BundleForm: `${JIG}BundleForm`,
    Archive: `${JIG}Archive`,
    FlattenedProfile: `${JIG}FlattenedProfile`,
    bundleForm: `${JIG}bundleForm`,
    canonicalDigest: `${JIG}canonicalDigest`
  }),
  lv2: Object.freeze({
    port: `${LV2}port`,
    symbol: `${LV2}symbol`,
    name: `${LV2}name`,
    default: `${LV2}default`,
    minimum: `${LV2}minimum`,
    maximum: `${LV2}maximum`,
    portProperty: `${LV2}portProperty`,
    scalePoint: `${LV2}scalePoint`,
    toggled: `${LV2}toggled`,
    enumeration: `${LV2}enumeration`,
    InputPort: `${LV2}InputPort`,
    OutputPort: `${LV2}OutputPort`,
    ControlPort: `${LV2}ControlPort`,
    AudioPort: `${LV2}AudioPort`
  }),
  // MIDI controller bindings on ports. LV2's own MIDI extension, reused rather
  // than invented: a port's midi:binding names a midi:Controller carrying the
  // controller number that drives it.
  midi: Object.freeze({
    binding: `${MIDI}binding`,
    Controller: `${MIDI}Controller`,
    controllerNumber: `${MIDI}controllerNumber`
  }),
  units: Object.freeze({
    unit: `${UNITS}unit`
  }),
  // How much a port matters for controlling the plugin: a nonnegative integer, higher is more important, comparable only within one
  // plugin. A host with room for a few controls shows those first (docs/plugin-profiles.md, "Which controls come first").
  pprops: Object.freeze({
    displayPriority: `${PPROPS}displayPriority`,
    // A port whose range is better read as ratios than as steps, such as a frequency: a panel places it on a log scale.
    logarithmic: `${PPROPS}logarithmic`
  })
});

// src/rdf/ProfileReader.js
var { jig, trn, lv2, midi, rdfs, foaf, units, pprops, rdf: rdfTerms } = vocabulary;
var iri = (value) => env_default.namedNode(value);
function objects(dataset2, subject, predicate) {
  return [...dataset2.match(subject, iri(predicate), null)].map((q) => q.object);
}
function one(dataset2, subject, predicate) {
  return objects(dataset2, subject, predicate)[0] ?? null;
}
var asString = (term2) => term2 ? term2.value : null;
function asBoolean(term2) {
  if (!term2) return false;
  if (term2.value === "true" || term2.value === "1") return true;
  if (term2.value === "false" || term2.value === "0") return false;
  throw new Error(`not a boolean: ${term2.value}`);
}
function sidechainIndex(dataset2, subject) {
  const index = asNumber(one(dataset2, subject, jig.sidechainInput));
  if (index === null) return null;
  const inputs = asNumber(one(dataset2, subject, jig.audioInputs)) ?? 0;
  if (!Number.isInteger(index) || index < 0 || index >= inputs) {
    throw new Error(`jig:sidechainInput ${index} names no audio input: the plugin declares ${inputs}`);
  }
  return index;
}
function asNumber(term2) {
  if (!term2) return null;
  const n2 = Number(term2.value);
  if (!Number.isFinite(n2)) throw new Error(`not a number: ${term2.value}`);
  return n2;
}
var values = (dataset2, subject, predicate) => objects(dataset2, subject, predicate).map((t) => t.value);
function resolveLocation(location, baseIRI) {
  return new URL(location, baseIRI).toString();
}
function rebaseLocation(location, canonical, retrieval) {
  if (!location || !canonical || !retrieval || canonical === retrieval) return location;
  return location.startsWith(canonical) ? retrieval + location.slice(canonical.length) : location;
}
function readResource(dataset2, term2, baseIRI, canonical) {
  if (!term2) return null;
  const location = one(dataset2, term2, jig.location);
  const resolved = location ? resolveLocation(location.value, baseIRI) : null;
  return {
    iri: term2.value,
    location: rebaseLocation(resolved, canonical, baseIRI),
    integrity: asString(one(dataset2, term2, jig.integrity)),
    mediaType: asString(one(dataset2, term2, jig.mediaType)),
    registeredName: asString(one(dataset2, term2, jig.registeredName)),
    wasmFeatures: values(dataset2, term2, jig.wasmFeature),
    userReplaceable: asBoolean(one(dataset2, term2, jig.userReplaceable)),
    maxBytes: asNumber(one(dataset2, term2, jig.maxBytes))
  };
}
function readScalePoints(dataset2, port) {
  return objects(dataset2, port, lv2.scalePoint).map((point) => ({
    label: asString(one(dataset2, point, rdfs.label)),
    value: asNumber(one(dataset2, point, rdfTerms.value))
  })).sort((a2, b) => a2.value - b.value);
}
function readController(dataset2, port) {
  const binding = one(dataset2, port, midi.binding);
  if (!binding) return null;
  return asNumber(one(dataset2, binding, midi.controllerNumber));
}
function widgetFor(port) {
  const twoScalePoints = port.scalePoints.length === 2;
  if (port.toggled || port.enumeration && twoScalePoints) return "switch";
  if (port.enumeration && port.scalePoints.length > 2) return "selector";
  return "dial";
}
function orderPorts(ports) {
  const authored = ports.length > 0 && ports.every((p) => p.paramIndex != null);
  return ports.sort(authored ? (a2, b) => a2.paramIndex - b.paramIndex : (a2, b) => (a2.symbol ?? "").localeCompare(b.symbol ?? ""));
}
function readDisplayPriority(dataset2, term2) {
  const priority = asNumber(one(dataset2, term2, pprops.displayPriority));
  if (priority !== null && !(Number.isInteger(priority) && priority >= 0)) {
    throw new Error(`port ${term2.value}: pprops:displayPriority must be a nonnegative integer, not ${priority}`);
  }
  return priority;
}
function readLogarithmic(properties, dataset2, term2) {
  if (!properties.includes(pprops.logarithmic)) return false;
  const minimum = asNumber(one(dataset2, term2, lv2.minimum));
  if (!(minimum > 0)) throw new Error(`port ${term2.value}: pprops:logarithmic needs an lv2:minimum above zero, not ${minimum}`);
  return true;
}
function readPads(dataset2, subject, ports) {
  return objects(dataset2, subject, jig.pad).map((pad) => {
    const where2 = `pad ${pad.value}`;
    const label = asString(one(dataset2, pad, rdfs.label));
    if (!label) throw new Error(`${where2}: a control pad needs an rdfs:label`);
    const axis = (predicate) => {
      const target = one(dataset2, pad, predicate);
      if (!target) throw new Error(`${where2}: missing ${predicate.slice(JIG.length)}`);
      const port = ports.find((p) => p.iri === target.value);
      if (!port) throw new Error(`${where2}: ${predicate.slice(JIG.length)} names ${target.value}, which is not a port of this profile`);
      if (port.widget !== "dial") throw new Error(`${where2}: ${predicate.slice(JIG.length)} names ${port.symbol}, which is a ${port.widget}, and a pad needs a continuous control`);
      return port.symbol;
    };
    const x = axis(jig.padX);
    const y = axis(jig.padY);
    if (x === y) throw new Error(`${where2}: both axes are ${x}`);
    let choice = null;
    const choiceTerm = one(dataset2, pad, jig.padChoice);
    if (choiceTerm) {
      const port = ports.find((p) => p.iri === choiceTerm.value);
      if (!port) throw new Error(`${where2}: padChoice names ${choiceTerm.value}, which is not a port of this profile`);
      if (port.widget !== "selector") throw new Error(`${where2}: padChoice names ${port.symbol}, which is a ${port.widget}, and a pad's choice must be a selector`);
      if (port.symbol === x || port.symbol === y) throw new Error(`${where2}: padChoice is ${port.symbol}, which is also an axis`);
      choice = port.symbol;
    }
    const end = (predicate) => asString(one(dataset2, pad, predicate));
    return { iri: pad.value, label, x, y, choice, xLow: end(jig.padXLow), xHigh: end(jig.padXHigh), yLow: end(jig.padYLow), yHigh: end(jig.padYHigh) };
  });
}
function readPort(dataset2, term2) {
  const properties = values(dataset2, term2, lv2.portProperty);
  const port = {
    iri: term2.value,
    symbol: asString(one(dataset2, term2, lv2.symbol)),
    name: asString(one(dataset2, term2, lv2.name)),
    // One plain sentence saying what the control does, or null. The panel shows it on hover and focus and a screen reader hears it on focus.
    comment: asString(one(dataset2, term2, rdfs.comment)),
    defaultValue: asNumber(one(dataset2, term2, lv2.default)),
    minimum: asNumber(one(dataset2, term2, lv2.minimum)),
    maximum: asNumber(one(dataset2, term2, lv2.maximum)),
    unit: asString(one(dataset2, term2, units.unit)),
    toggled: properties.includes(lv2.toggled),
    // A frequency or a time is heard in ratios, so a panel places it on a log scale. Needs a minimum above zero (readLogarithmic).
    logarithmic: readLogarithmic(properties, dataset2, term2),
    enumeration: properties.includes(lv2.enumeration),
    scalePoints: readScalePoints(dataset2, term2),
    // The MIDI controller driving this port, if the profile binds one. Absent
    // means no claim, the same discipline as userReplaceable: a port the
    // profile does not bind answers to no controller.
    controller: readController(dataset2, term2),
    // The panel section this control belongs under, if the profile groups
    // its ports. Absent means ungrouped, which renders as today.
    group: asString(one(dataset2, term2, jig.controlGroup)),
    // How much the author says this control matters, or null. A panel shows the ports that have one first (src/ui/PrimaryControls.js).
    displayPriority: readDisplayPriority(dataset2, term2),
    // The author's order, where the profile gives one; the panel follows it.
    paramIndex: asNumber(one(dataset2, term2, jig.paramIndex)),
    // k-rate is the default. An a-rate parameter costs a 128 element
    // Float32Array per quantum whether or not anything modulates it.
    automationRate: one(dataset2, term2, jig.automationRate)?.value === jig.ARate ? "a-rate" : "k-rate"
  };
  port.widget = widgetFor(port);
  return port;
}
function findSubject(dataset2) {
  const subjects = [...dataset2.match(null, iri(rdfTerms.type), iri(jig.WebPlugin))].map((q) => q.subject);
  if (subjects.length === 0) {
    const foreign = [...dataset2.match(null, iri(rdfTerms.type), iri(jig.ForeignPlugin))];
    if (foreign.length > 0) {
      throw new Error(
        "this is a foreign plugin (contract section 12). It runs with this page's privileges and is not loaded without being asked for, and never on opening a project."
      );
    }
    if (dataset2.match(null, iri(rdfTerms.type), iri(jig.CompositePlugin)).size > 0) {
      throw new Error(
        "this is a composite plugin (docs/nested-plugins.md): a plugin made of other plugins, with no module or processor of its own. It is read by readComposite and loaded as a tree, not read as one plugin."
      );
    }
    throw new Error("no jig:WebPlugin in this document. A profile that does not declare itself loadable is a valid catalogue entry, but it cannot be run here.");
  }
  if (subjects.length > 1) {
    throw new Error(`${subjects.length} jig:WebPlugin subjects in one document; expected one`);
  }
  return subjects[0];
}
function readProfile(dataset2, { baseIRI } = {}) {
  const subject = findSubject(dataset2);
  const base = baseIRI ?? subject.value;
  const capabilities2 = values(dataset2, subject, trn.requires);
  const ports = orderPorts(objects(dataset2, subject, lv2.port).map((t) => readPort(dataset2, t)));
  return {
    iri: subject.value,
    label: asString(one(dataset2, subject, rdfs.label)),
    comment: asString(one(dataset2, subject, rdfs.comment)),
    vendor: asString(one(dataset2, subject, trn.vendor)),
    homepage: asString(one(dataset2, subject, foaf.homepage)),
    roles: values(dataset2, subject, trn.role),
    accepts: values(dataset2, subject, trn.accepts),
    produces: values(dataset2, subject, trn.produces),
    formats: values(dataset2, subject, trn.format),
    genres: values(dataset2, subject, trn.genre),
    cautions: values(dataset2, subject, trn.caution),
    recommendedBefore: values(dataset2, subject, trn.recommendedBefore),
    recommendedAfter: values(dataset2, subject, trn.recommendedAfter),
    requires: capabilities2,
    prefers: values(dataset2, subject, jig.prefers),
    audioInputs: asNumber(one(dataset2, subject, jig.audioInputs)) ?? 0,
    sidechainInput: sidechainIndex(dataset2, subject),
    stateless: asBoolean(one(dataset2, subject, jig.stateless)),
    audioOutputs: asNumber(one(dataset2, subject, jig.audioOutputs)) ?? 0,
    inputChannels: asNumber(one(dataset2, subject, jig.inputChannels)) ?? 2,
    outputChannels: asNumber(one(dataset2, subject, jig.outputChannels)) ?? 2,
    renderQuantum: asNumber(one(dataset2, subject, jig.renderQuantum)),
    latencyFrames: asNumber(one(dataset2, subject, jig.latencyFrames)) ?? 0,
    tailFrames: asNumber(one(dataset2, subject, jig.tailFrames)),
    module: readResource(dataset2, one(dataset2, subject, jig.module), base, subject.value),
    processor: readResource(dataset2, one(dataset2, subject, jig.processor), base, subject.value),
    ui: readResource(dataset2, one(dataset2, subject, jig.ui), base, subject.value),
    skin: readResource(dataset2, one(dataset2, subject, jig.skin), base, subject.value),
    assets: objects(dataset2, subject, jig.asset).map((t) => readResource(dataset2, t, base, subject.value)),
    ports,
    // Two-axis pads over pairs of the ports above, in the order the profile gives them.
    pads: readPads(dataset2, subject, ports)
  };
}

// src/host/Integrity.js
var ALGORITHMS = Object.freeze({
  sha256: "SHA-256",
  sha384: "SHA-384",
  sha512: "SHA-512"
});
function parseIntegrity(integrity) {
  if (typeof integrity !== "string" || integrity.length === 0) {
    throw new Error("no integrity digest; a resource without one cannot be loaded");
  }
  const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(integrity.trim());
  if (!match) {
    throw new Error(`malformed integrity digest: ${integrity}. Expected sha384-<base64>.`);
  }
  return { algorithm: match[1], subtleName: ALGORITHMS[match[1]], expected: match[2] };
}
function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
async function verifyIntegrity(bytes, integrity, { subtle = crypto.subtle } = {}) {
  const { algorithm, subtleName, expected } = parseIntegrity(integrity);
  const hash = await subtle.digest(subtleName, bytes);
  const actual = toBase64(hash);
  if (actual !== expected) {
    throw new Error(
      `integrity mismatch: declared ${algorithm}-${expected}, got ${algorithm}-${actual}`
    );
  }
  return `${algorithm}-${actual}`;
}

// src/host/Capabilities.js
var { jig: jig2, trn: trn2 } = vocabulary;
var PREFIXES = Object.freeze([["jig:", JIG], ["trn:", TRN]]);
var WASM_FEATURE_PROBES = Object.freeze({
  // A v128 from i8x16.splat, then i8x16.popcnt.
  [jig2.Simd128]: Uint8Array.of(
    0,
    97,
    115,
    109,
    1,
    0,
    0,
    0,
    1,
    5,
    1,
    96,
    0,
    1,
    123,
    3,
    2,
    1,
    0,
    10,
    10,
    1,
    8,
    0,
    65,
    0,
    253,
    15,
    253,
    98,
    11
  ),
  // memory.copy over a one page memory.
  [jig2.BulkMemory]: Uint8Array.of(
    0,
    97,
    115,
    109,
    1,
    0,
    0,
    0,
    1,
    4,
    1,
    96,
    0,
    0,
    3,
    2,
    1,
    0,
    5,
    3,
    1,
    0,
    1,
    10,
    14,
    1,
    12,
    0,
    65,
    0,
    65,
    0,
    65,
    0,
    252,
    10,
    0,
    0,
    11
  ),
  // An atomic load from a shared memory.
  [jig2.Threads]: Uint8Array.of(
    0,
    97,
    115,
    109,
    1,
    0,
    0,
    0,
    1,
    4,
    1,
    96,
    0,
    0,
    3,
    2,
    1,
    0,
    5,
    4,
    1,
    3,
    1,
    1,
    10,
    11,
    1,
    9,
    0,
    65,
    0,
    254,
    16,
    2,
    0,
    26,
    11
  ),
  // try with catch_all.
  [jig2.ExceptionHandling]: Uint8Array.of(
    0,
    97,
    115,
    109,
    1,
    0,
    0,
    0,
    1,
    4,
    1,
    96,
    0,
    0,
    3,
    2,
    1,
    0,
    10,
    8,
    1,
    6,
    0,
    6,
    64,
    25,
    11,
    11
  )
});
function compact(iri4) {
  for (const [prefix, namespace2] of PREFIXES) {
    if (iri4.startsWith(namespace2)) return prefix + iri4.slice(namespace2.length);
  }
  return iri4;
}
function detectCapabilities(env = globalThis) {
  const offered = /* @__PURE__ */ new Set([
    // Always provided by the host itself rather than by the platform.
    trn2.HostTransport,
    jig2.MidiEvents,
    // Collecting what a plugin emits and routing it onward. Separate from
    // MidiEvents because they are separate services and a host may do one and
    // not the other: EventRouter.observe is what makes this one true here.
    jig2.MidiOut,
    jig2.Persistence,
    jig2.OfflineRender
  ]);
  if (typeof env.WebAssembly?.validate === "function") {
    for (const [feature, probe] of Object.entries(WASM_FEATURE_PROBES)) {
      if (env.WebAssembly.validate(probe)) offered.add(feature);
    }
  }
  if (env.crossOriginIsolated === true) {
    offered.add(jig2.CrossOriginIsolation);
    if (typeof env.SharedArrayBuffer === "function") offered.add(jig2.SharedMemory);
  }
  return offered;
}
function negotiate(profile, offered) {
  const available = offered instanceof Set ? offered : new Set(offered);
  const needed = [...profile.requires ?? [], ...profile.module?.wasmFeatures ?? []];
  const missing = needed.filter((c3) => !available.has(c3));
  const granted = [
    ...profile.requires ?? [],
    ...(profile.prefers ?? []).filter((c3) => available.has(c3))
  ];
  return {
    satisfied: missing.length === 0,
    missing,
    granted: [...new Set(granted)]
  };
}
function explainMissing(profile, missing) {
  const names = missing.map(compact).join(", ");
  return `${profile.label ?? profile.iri} requires ${names}, which this host does not offer`;
}

// src/host/LoadError.js
var LoadError = class extends Error {
  constructor(step, message, { cause, iri: iri4 } = {}) {
    super(message, { cause });
    this.name = "LoadError";
    this.step = step;
    this.iri = iri4 ?? null;
  }
  toString() {
    return `${this.name} [${this.step}]: ${this.message}`;
  }
};
var CompositeFound = class extends LoadError {
  constructor(iri4, dataset2) {
    super("composite", `${iri4} is a composite plugin, which is resolved as a tree and not read as one plugin`, { iri: iri4 });
    this.name = "CompositeFound";
    this.dataset = dataset2;
  }
};
var STEPS = Object.freeze({
  fetchProfile: "fetch-profile",
  parseProfile: "parse-profile",
  validateProfile: "validate-profile",
  capabilities: "capabilities",
  composite: "composite",
  fetchResource: "fetch-resource",
  integrity: "integrity",
  compileModule: "compile-module",
  registerProcessor: "register-processor",
  constructNode: "construct-node",
  ready: "ready"
});

// src/rdf/CompositeReader.js
var { jig: jig3, lv2: lv22, rdf: rdfTerms2, trn: trn3 } = vocabulary;
var iri2 = (value) => env_default.namedNode(value);
var objects2 = (dataset2, subject, predicate) => [...dataset2.match(typeof subject === "string" ? iri2(subject) : subject, iri2(predicate), null)].map((q) => q.object);
var first = (dataset2, subject, predicate) => objects2(dataset2, subject, predicate)[0]?.value ?? null;
var number = (value) => value === null ? null : Number(value);
function readEndpoint(dataset2, node) {
  const index = number(first(dataset2, node, jig3.portIndex));
  const symbol = first(dataset2, node, jig3.portSymbol);
  return { node: first(dataset2, node, jig3.endpointNode), ...index !== null ? { portIndex: index } : {}, ...symbol !== null ? { portSymbol: symbol } : {} };
}
var isComposite = (dataset2) => dataset2.match(null, iri2(rdfTerms2.type), iri2(jig3.CompositePlugin)).size > 0;
function readComposite(dataset2, { iri: wanted = null } = {}) {
  const subjects = [...dataset2.match(null, iri2(rdfTerms2.type), iri2(jig3.CompositePlugin))].map((q) => q.subject).filter((subject2) => wanted === null || subject2.value === wanted);
  if (subjects.length === 0) throw new Error("the document declares no jig:CompositePlugin");
  if (subjects.length > 1) {
    throw new Error(`the document declares ${subjects.length} composites (${subjects.map((s) => s.value).join(", ")}); a composite document holds one`);
  }
  const subject = subjects[0];
  const byId = (a2, b) => a2.id.localeCompare(b.id);
  const members = objects2(dataset2, subject, jig3.member).map((m) => ({
    id: m.value,
    plugin: first(dataset2, m, jig3.plugin),
    pinnedDigest: first(dataset2, m, jig3.pinnedDigest),
    settings: objects2(dataset2, m, jig3.setting).map((s) => ({ symbol: first(dataset2, s, jig3.symbol), value: number(first(dataset2, s, jig3.value)) })).sort((a2, b) => a2.symbol.localeCompare(b.symbol))
  })).sort(byId);
  const connections = objects2(dataset2, subject, jig3.connection).map((c3) => ({
    id: c3.value,
    from: readEndpoint(dataset2, objects2(dataset2, c3, jig3.from)[0]),
    to: readEndpoint(dataset2, objects2(dataset2, c3, jig3.to)[0]),
    signalKind: first(dataset2, c3, jig3.signalKind)
  })).sort(byId);
  const ports = objects2(dataset2, subject, lv22.port).map((p) => ({
    ...readPort(dataset2, p),
    drives: objects2(dataset2, p, jig3.drives).map((d) => readEndpoint(dataset2, d))
  })).sort((a2, b) => a2.symbol.localeCompare(b.symbol));
  return {
    iri: subject.value,
    label: first(dataset2, subject, vocabulary.rdfs.label),
    comment: first(dataset2, subject, vocabulary.rdfs.comment),
    vendor: first(dataset2, subject, trn3.vendor),
    homepage: first(dataset2, subject, vocabulary.foaf.homepage),
    roles: objects2(dataset2, subject, trn3.role).map((o2) => o2.value),
    accepts: objects2(dataset2, subject, trn3.accepts).map((o2) => o2.value),
    produces: objects2(dataset2, subject, trn3.produces).map((o2) => o2.value),
    formats: objects2(dataset2, subject, trn3.format).map((o2) => o2.value),
    genres: objects2(dataset2, subject, trn3.genre).map((o2) => o2.value),
    cautions: objects2(dataset2, subject, trn3.caution).map((o2) => o2.value),
    inputChannels: number(first(dataset2, subject, jig3.inputChannels)) ?? 2,
    outputChannels: number(first(dataset2, subject, jig3.outputChannels)) ?? 2,
    audioInputs: number(first(dataset2, subject, jig3.audioInputs)),
    audioOutputs: number(first(dataset2, subject, jig3.audioOutputs)),
    requires: objects2(dataset2, subject, trn3.requires).map((o2) => o2.value),
    members,
    connections,
    ports
  };
}
var compositeProfile = (composite) => ({
  iri: composite.iri,
  label: composite.label,
  comment: composite.comment,
  vendor: composite.vendor,
  homepage: composite.homepage,
  roles: composite.roles,
  accepts: composite.accepts,
  produces: composite.produces,
  formats: composite.formats,
  genres: composite.genres,
  cautions: composite.cautions,
  recommendedBefore: [],
  recommendedAfter: [],
  requires: composite.requires,
  prefers: [],
  audioInputs: composite.audioInputs ?? 0,
  sidechainInput: null,
  audioOutputs: composite.audioOutputs ?? 0,
  inputChannels: composite.inputChannels,
  outputChannels: composite.outputChannels,
  renderQuantum: null,
  latencyFrames: 0,
  tailFrames: null,
  stateless: false,
  composite: true,
  // No code of its own: its members carry it.
  module: null,
  processor: null,
  ui: null,
  assets: [],
  ports: composite.ports
});

// src/host/Parameters.js
function parameterDescriptors(ports) {
  return ports.filter((p) => p.symbol !== null).map((port) => {
    for (const [field, value] of Object.entries({
      defaultValue: port.defaultValue,
      minValue: port.minimum,
      maxValue: port.maximum
    })) {
      if (value === null || value === void 0) {
        throw new Error(`port ${port.symbol} has no ${field}; a parameter without a range cannot be an AudioParam`);
      }
    }
    if (port.defaultValue < port.minimum || port.defaultValue > port.maximum) {
      throw new Error(
        `port ${port.symbol} has default ${port.defaultValue} outside its range ${port.minimum}..${port.maximum}`
      );
    }
    return {
      name: port.symbol,
      defaultValue: port.defaultValue,
      minValue: port.minimum,
      maxValue: port.maximum,
      automationRate: port.automationRate === "a-rate" ? "a-rate" : "k-rate"
    };
  });
}

// src/host/Instantiate.js
var registeredByContext = /* @__PURE__ */ new WeakMap();
function registeredNamesFor(context2) {
  let set = registeredByContext.get(context2);
  if (!set) {
    set = /* @__PURE__ */ new Set();
    registeredByContext.set(context2, set);
  }
  return set;
}
async function instantiate(profile, granted, context2, {
  fetchVerified,
  AudioWorkletNode = globalThis.AudioWorkletNode,
  validate = (bytes) => WebAssembly.validate(bytes),
  processorUrl = null,
  state = null
} = {}) {
  const processorBytes = await fetchVerified(profile.processor, { kind: "processor" });
  let moduleBytes = null;
  if (profile.module) {
    moduleBytes = await fetchVerified(profile.module, { kind: "module" });
    if (!validate(moduleBytes)) {
      throw new LoadError(
        STEPS.compileModule,
        `the file at ${profile.module.location} is not valid WebAssembly`
      );
    }
  }
  const assets = {};
  for (const asset of profile.assets ?? []) {
    const name2 = asset.iri?.split("#").pop() ?? asset.iri;
    assets[name2] = await fetchVerified(asset, { kind: `asset "${name2}"` });
  }
  const registered = registeredNamesFor(context2);
  const name = profile.processor.registeredName;
  const url = await resolveProcessorUrl(processorBytes, profile.processor.location, processorUrl);
  if (name && !registered.has(name)) {
    try {
      await context2.audioWorklet.addModule(url);
    } catch (cause) {
      throw new LoadError(
        STEPS.registerProcessor,
        `the processor at ${profile.processor.location} failed to register: ${cause.message}`,
        { cause }
      );
    }
    if (name) registered.add(name);
  }
  if (!name) {
    throw new LoadError(
      STEPS.constructNode,
      "the profile declares no jig:registeredName, and a worklet cannot be asked what it registered"
    );
  }
  let node;
  try {
    const driven = profile.audioOutputs === 0 && profile.audioInputs === 0;
    node = new AudioWorkletNode(context2, name, {
      numberOfInputs: driven ? 1 : profile.audioInputs,
      numberOfOutputs: profile.audioOutputs,
      outputChannelCount: profile.audioOutputs > 0 ? Array(profile.audioOutputs).fill(profile.outputChannels) : void 0,
      parameterData: {},
      processorOptions: {
        capabilities: granted,
        sampleRate: context2.sampleRate,
        quantum: profile.renderQuantum ?? 128
      }
    });
    if (driven) node.jigdawNeedsDriving = true;
  } catch (cause) {
    throw new LoadError(
      STEPS.constructNode,
      `could not construct "${name}": ${cause.message}. The processor module may register a different name.`,
      { cause }
    );
  }
  const ready = await init(node, moduleBytes, assets, granted, context2, profile, state);
  const descriptors = parameterDescriptors(profile.ports);
  return { node, ready, descriptors };
}
function transferablesIn(value, into = [], seen = /* @__PURE__ */ new Set()) {
  if (value instanceof ArrayBuffer) {
    into.push(value);
    return into;
  }
  if (value === null || typeof value !== "object" || seen.has(value)) return into;
  seen.add(value);
  for (const item of Array.isArray(value) ? value : Object.values(value)) transferablesIn(item, into, seen);
  return into;
}
var READY_TIMEOUT_MS = 3e4;
function init(node, moduleBytes, assets, granted, context2, profile, state) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      node.port.onmessage = null;
      reject(new LoadError(
        STEPS.ready,
        `"${profile.processor.registeredName}" did not report ready in ${READY_TIMEOUT_MS / 1e3} seconds. A processor must post { type: "ready" } once its buffers exist. On a slow device the audio thread may be too busy running the plugins already loaded.`
      ));
    }, READY_TIMEOUT_MS);
    node.port.onmessage = (event) => {
      const message = event.data;
      if (message?.type === "ready") {
        clearTimeout(timeout);
        node.port.onmessage = null;
        resolve({ latencyFrames: message.latencyFrames ?? 0, tailFrames: message.tailFrames ?? null });
      } else if (message?.type === "error" && message.fatal !== false) {
        clearTimeout(timeout);
        node.port.onmessage = null;
        reject(new LoadError(STEPS.ready, `${message.phase ?? "instantiate"}: ${message.message}`));
      }
    };
    const buffer = moduleBytes ? moduleBytes.buffer.slice(moduleBytes.byteOffset, moduleBytes.byteOffset + moduleBytes.byteLength) : null;
    const assetBuffers = {};
    for (const [name, bytes] of Object.entries(assets ?? {})) {
      assetBuffers[name] = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    const transfer = [
      ...buffer ? [buffer] : [],
      ...Object.values(assetBuffers),
      ...transferablesIn(state)
    ];
    node.port.postMessage({
      type: "init",
      module: buffer,
      assets: assetBuffers,
      capabilities: granted,
      sampleRate: context2.sampleRate,
      quantum: profile.renderQuantum ?? 128,
      ...state !== null && state !== void 0 ? { state } : {}
    }, transfer);
  });
}
async function resolveProcessorUrl(bytes, originalUrl, override) {
  if (override) return override(bytes, originalUrl);
  if (typeof Blob === "undefined" || typeof URL.createObjectURL !== "function") {
    return originalUrl;
  }
  return URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
}

// src/host/PluginLoader.js
var PROFILE_ACCEPT = "text/turtle, application/ld+json;q=0.9";
var PluginLoader = class {
  #fetch;
  #parse;
  #validator;
  #capabilities;
  #validate;
  #processorUrlFor;
  /**
   * @param fetch       fetch implementation
   * @param parse       (text, baseIRI) => Promise<dataset>
   * @param validator   ShapeValidator, or null to skip shape validation
   * @param capabilities Set of capability IRIs this host offers
   * @param validate    bytes => boolean, a cheap check before posting
   */
  constructor({
    // Bound, not taken by reference. A browser's fetch must be called with the
    // window as its receiver and throws "Illegal invocation" otherwise, while
    // node's does not care. So a detached reference passes every test here and
    // fails on the first real page load.
    fetch: fetch2 = (...args) => globalThis.fetch(...args),
    parse,
    validator = null,
    capabilities: capabilities2 = detectCapabilities(),
    validate = (bytes) => WebAssembly.validate(bytes),
    processorUrl = null
  } = {}) {
    if (typeof fetch2 !== "function") throw new Error("PluginLoader needs a fetch implementation");
    if (typeof parse !== "function") throw new Error("PluginLoader needs a parse function");
    this.#fetch = fetch2;
    this.#parse = parse;
    this.#validator = validator;
    this.#capabilities = capabilities2;
    this.#validate = validate;
    this.#processorUrlFor = processorUrl;
  }
  /**
   * Contract section 3.1 steps 1 and 2 for a plugin of either kind, as a listing needs them: the profile, and whether
   * this host can run it, with no code fetched. A composite is read as its own profile and its own `trn:requires`; the
   * members are checked when it is loaded, as nested-plugins.md section 6 says, and a collection of forty racks does not
   * fetch forty trees to draw a list.
   */
  async loadListing(iri4) {
    const dataset2 = await this.fetchDataset(iri4);
    if (!isComposite(dataset2)) return this.profileFrom(dataset2, iri4);
    let profile;
    try {
      profile = compositeProfile(readComposite(dataset2));
    } catch (cause) {
      throw new LoadError(STEPS.parseProfile, cause.message, { cause, iri: iri4 });
    }
    return { profile, granted: this.checkCapabilities(profile, iri4) };
  }
  /** Steps 1 to 3: fetch, parse, validate, and check capabilities. */
  async loadProfile(iri4) {
    const dataset2 = await this.fetchDataset(iri4);
    if (isComposite(dataset2)) throw new CompositeFound(iri4, dataset2);
    return this.profileFrom(dataset2, iri4);
  }
  /**
   * Steps 1 to 3 up to the capability check: fetch, parse and validate. Split out so a composite plugin, which
   * reads differently, goes through the same fetch and validation as any plugin (docs/nested-plugins.md).
   */
  async fetchDataset(iri4) {
    let response;
    try {
      response = await this.#fetch(iri4, { headers: { accept: PROFILE_ACCEPT } });
    } catch (cause) {
      throw new LoadError(
        STEPS.fetchProfile,
        `could not fetch ${iri4}: ${cause?.message ?? cause}. If the profile is on another origin, it must be served with Access-Control-Allow-Origin.`,
        { cause, iri: iri4 }
      );
    }
    if (!response.ok) {
      throw new LoadError(STEPS.fetchProfile, `${iri4} returned ${response.status}`, { iri: iri4 });
    }
    const text = await response.text();
    let dataset2;
    try {
      dataset2 = await this.#parse(text, iri4);
    } catch (cause) {
      throw new LoadError(STEPS.parseProfile, `${iri4} is not parseable RDF: ${cause.message}`, { cause, iri: iri4 });
    }
    if (this.#validator) {
      const report = await this.#validator.validate(dataset2);
      if (!report.conforms) {
        const first3 = report.violations[0];
        throw new LoadError(
          STEPS.validateProfile,
          `${iri4} is not a valid profile: ${first3.message} (at ${first3.focusNode}${first3.path ? ` ${first3.path}` : ""})`,
          { iri: iri4 }
        );
      }
    }
    return dataset2;
  }
  /** Read a fetched profile and check its capabilities before any code is fetched. Contract section 2.1. */
  profileFrom(dataset2, iri4) {
    let profile;
    try {
      profile = readProfile(dataset2, { baseIRI: iri4 });
    } catch (cause) {
      throw new LoadError(STEPS.parseProfile, cause.message, { cause, iri: iri4 });
    }
    return { profile, granted: this.checkCapabilities(profile, iri4) };
  }
  /**
   * Contract section 2.1, evaluated BEFORE any code is fetched. Takes anything with `requires`, so a
   * composite, which has no module, is checked by the same rule as a plugin. Returns what is granted.
   */
  checkCapabilities(profile, iri4) {
    const negotiation = negotiate(profile, this.#capabilities);
    if (!negotiation.satisfied) {
      throw new LoadError(STEPS.capabilities, explainMissing(profile, negotiation.missing), { iri: iri4 });
    }
    return negotiation.granted;
  }
  /** Steps 4 and 5 for one resource: fetch it and verify its digest. */
  async fetchVerified(resource, { kind }) {
    if (!resource?.location) {
      throw new LoadError(STEPS.fetchResource, `the profile declares no location for its ${kind}`);
    }
    let response;
    try {
      response = await this.#fetch(resource.location);
    } catch (cause) {
      throw new LoadError(
        STEPS.fetchResource,
        `could not fetch the ${kind} at ${resource.location}: ${cause?.message ?? cause}. If it is on another origin, it must be served with Access-Control-Allow-Origin.`,
        { cause }
      );
    }
    if (!response.ok) {
      throw new LoadError(STEPS.fetchResource, `the ${kind} at ${resource.location} returned ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    try {
      await verifyIntegrity(bytes, resource.integrity);
    } catch (cause) {
      throw new LoadError(STEPS.integrity, `the ${kind} at ${resource.location} failed verification: ${cause.message}`, { cause });
    }
    return bytes;
  }
  /**
   * Steps 4 to 8. Returns a connected-ready AudioWorkletNode.
   *
   * The node is NOT connected to anything here. Contract section 3.1 forbids
   * connecting before ready, and this returns after ready, so the caller
   * connects. Doing it here would take the decision away from the graph.
   *
   * The work lives in Instantiate.js, which knows nothing about RDF so that a
   * caller holding an already-resolved profile can use it without pulling a
   * Turtle parser into a browser bundle. This stays the front door.
   */
  instantiate(profile, granted, context2, { AudioWorkletNode = globalThis.AudioWorkletNode, state = null } = {}) {
    return instantiate(profile, granted, context2, {
      fetchVerified: (resource, options) => this.fetchVerified(resource, options),
      AudioWorkletNode,
      validate: this.#validate,
      processorUrl: this.#processorUrlFor,
      state
    });
  }
};

// src/rdf/SkinReader.js
var { jig: jig4, rdf: rdfTerms3 } = vocabulary;
var KINDS = /* @__PURE__ */ new Map([
  [jig4.RotaryControl, "rotary"],
  [jig4.LinearControl, "linear"],
  [jig4.ToggleControl, "toggle"],
  [jig4.SelectorControl, "selector"],
  [jig4.ReadoutControl, "readout"]
]);
var iri3 = (value) => env_default.namedNode(value);
var objects3 = (dataset2, subject, predicate) => [...dataset2.match(typeof subject === "string" ? iri3(subject) : subject, iri3(predicate), null)].map((q) => q.object);
var first2 = (dataset2, subject, predicate) => objects3(dataset2, subject, predicate)[0]?.value ?? null;
var number2 = (value) => value === null ? null : Number(value);
function readSkin(dataset2) {
  const subjects = [...new Set([...dataset2.match(null, iri3(jig4.artwork), null)].map((q) => q.subject.value))];
  if (subjects.length > 1) throw new Error(`a skin document describes one skin; this one has jig:artwork on ${subjects.join(", ")}`);
  const documentIri = subjects[0] ?? null;
  if (documentIri === null) return { iri: null, artwork: null, controls: [] };
  const doc = iri3(documentIri);
  const art = objects3(dataset2, doc, jig4.artwork)[0] ?? null;
  const controls = objects3(dataset2, doc, jig4.control).map((node) => {
    const kinds = objects3(dataset2, node, rdfTerms3.type).map((t) => KINDS.get(t.value)).filter(Boolean);
    return {
      id: node.value,
      kind: kinds[0] ?? null,
      boundSymbol: first2(dataset2, node, jig4.boundSymbol),
      element: first2(dataset2, node, jig4.element),
      hitElement: first2(dataset2, node, jig4.hitElement),
      pivotElement: first2(dataset2, node, jig4.pivotElement),
      trackElement: first2(dataset2, node, jig4.trackElement),
      angleMin: number2(first2(dataset2, node, jig4.angleMin)),
      angleMax: number2(first2(dataset2, node, jig4.angleMax))
    };
  }).sort((a2, b) => a2.id.localeCompare(b.id));
  return {
    iri: documentIri,
    artwork: art === null ? null : {
      iri: art.value,
      location: first2(dataset2, art, jig4.location),
      integrity: first2(dataset2, art, jig4.integrity),
      mediaType: first2(dataset2, art, jig4.mediaType)
    },
    controls
  };
}
function stepsOf(port) {
  if (port.toggled) return 2;
  if (port.scalePoints.length > 0) return port.scalePoints.length;
  const span = port.maximum - port.minimum;
  return Number.isInteger(span) ? span + 1 : null;
}
function checkSkin(skin, artwork, ports) {
  const bySymbol = new Map(ports.map((p) => [p.symbol, p]));
  const omitted = [];
  const keep = [];
  const bound = /* @__PURE__ */ new Set();
  for (const control of skin.controls) {
    const refuse = (reason) => omitted.push({ control: control.id, reason });
    const port = bySymbol.get(control.boundSymbol);
    if (control.kind === null) {
      refuse("it has no control class");
      continue;
    }
    if (!port) {
      refuse(`the plugin declares no port "${control.boundSymbol}"`);
      continue;
    }
    const sets = control.kind !== "readout";
    if (sets && bound.has(control.boundSymbol)) {
      refuse(`port "${control.boundSymbol}" is already bound by an earlier control`);
      continue;
    }
    const named = [
      ["jig:element", control.element],
      ["jig:hitElement", control.hitElement],
      ["jig:pivotElement", control.pivotElement],
      ["jig:trackElement", control.trackElement]
    ];
    const missing = named.filter(([, id]) => id !== null && !artwork.ids.has(id)).map(([term2, id]) => `${term2} "${id}"`);
    if (control.element === null) missing.push("jig:element (none given)");
    if (missing.length) {
      refuse(`the artwork has no element for ${missing.join(", ")}`);
      continue;
    }
    if (control.kind === "toggle") {
      const children = artwork.ids.get(control.element);
      if (children !== 2) {
        refuse(`a toggle needs 2 child groups and "${control.element}" has ${children}`);
        continue;
      }
    }
    if (control.kind === "selector") {
      const steps = stepsOf(port);
      const children = artwork.ids.get(control.element);
      if (steps === null) {
        refuse(`port "${port.symbol}" has no whole number of steps to choose between`);
        continue;
      }
      if (children !== steps) {
        refuse(`a selector for "${port.symbol}" needs ${steps} child groups and "${control.element}" has ${children}`);
        continue;
      }
    }
    if (sets) bound.add(control.boundSymbol);
    keep.push(control);
  }
  return { keep, omitted, unbound: ports.map((p) => p.symbol).filter((s) => !bound.has(s)) };
}

// src/ui/SkinArtwork.js
var SVG_NS = "http://www.w3.org/2000/svg";
var SKIN_LIMITS = Object.freeze({ bytes: 512 * 1024, elements: 5e3 });
var ELEMENTS = /* @__PURE__ */ new Set([
  "svg",
  "g",
  "defs",
  "title",
  "desc",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "use"
]);
var ATTRIBUTES = /* @__PURE__ */ new Set([
  "id",
  "viewBox",
  "width",
  "height",
  "preserveAspectRatio",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "fr",
  "dx",
  "dy",
  "d",
  "points",
  "transform",
  "offset",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "clipPathUnits",
  "fill",
  "fill-opacity",
  "fill-rule",
  "clip-rule",
  "clip-path",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stop-color",
  "stop-opacity",
  "opacity",
  "display",
  "visibility",
  "paint-order",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "style",
  "href"
]);
var STYLE_PROPERTIES = new Set([...ATTRIBUTES].filter((a2) => a2.includes("-") || ["fill", "stroke", "opacity", "display", "visibility"].includes(a2)));
var SkinError = class extends Error {
  constructor(message, element = null) {
    super(element === null ? message : `${message} (at ${element})`);
    this.name = "SkinError";
    this.element = element;
  }
};
function parseSvg(text, DOMParserClass = globalThis.DOMParser) {
  const doc = new DOMParserClass().parseFromString(text, "image/svg+xml");
  const failure = doc.getElementsByTagName("parsererror")[0];
  if (failure) throw new SkinError(`the artwork is not well formed XML: ${failure.textContent.trim().split("\n")[0]}`);
  return doc;
}
var FRAGMENT = /^#([^\s()'"]+)$/;
var URL_REFERENCE = /url\(\s*([^)]*?)\s*\)/gi;
function checkValue(value, where2) {
  if (/javascript:|@import|expression\(/i.test(value)) throw new SkinError(`an attribute value runs or imports code: ${value.slice(0, 40)}`, where2);
  for (const m of value.matchAll(URL_REFERENCE)) {
    if (!FRAGMENT.test(m[1].replace(/^['"]|['"]$/g, ""))) {
      throw new SkinError(`a url() leaves the file: ${m[0]}`, where2);
    }
  }
}
function pathOf(stack) {
  return stack.join(" > ");
}
function buildArtwork(doc, { document: document2, prefix, limits = SKIN_LIMITS, size = 0 }) {
  if (typeof prefix !== "string" || prefix === "") throw new TypeError("buildArtwork needs an id prefix, or two skins on one page can collide");
  if (size > limits.bytes) throw new SkinError(`the artwork is ${size} bytes; the limit is ${limits.bytes}`);
  const root = doc.documentElement;
  if (!root || root.namespaceURI !== SVG_NS || root.localName !== "svg") {
    throw new SkinError("the artwork root is not an svg element in the SVG namespace", root ? root.nodeName : "the document");
  }
  const ids = /* @__PURE__ */ new Map();
  const elements = /* @__PURE__ */ new Map();
  let count = 0;
  const rename = (value) => value.replace(URL_REFERENCE, (all, ref) => {
    const m = FRAGMENT.exec(ref.replace(/^['"]|['"]$/g, ""));
    return m ? `url(#${prefix}${m[1]})` : all;
  });
  function copy(source2, stack) {
    const name = source2.localName;
    if (source2.namespaceURI !== SVG_NS) return null;
    if (!ELEMENTS.has(name)) throw new SkinError(`<${name}> is not an allowed element`, pathOf(stack));
    if (++count > limits.elements) throw new SkinError(`the artwork has more than ${limits.elements} elements`, pathOf(stack));
    const target = document2.createElementNS(SVG_NS, name);
    for (const attr of [...source2.attributes]) {
      const attrName = attr.localName ?? attr.name;
      if (attr.namespaceURI && attr.namespaceURI !== SVG_NS) continue;
      if (/^on/i.test(attrName)) throw new SkinError(`event attribute ${attrName} is not allowed`, pathOf(stack));
      if (!ATTRIBUTES.has(attrName)) continue;
      let value = attr.value;
      if (attrName === "href") {
        const m = FRAGMENT.exec(value);
        if (!m) throw new SkinError(`href "${value.slice(0, 40)}" leaves the file`, pathOf(stack));
        target.setAttribute("href", `#${prefix}${m[1]}`);
        continue;
      }
      if (attrName === "style") {
        if (value.includes("\\")) throw new SkinError("a style attribute uses a CSS escape", pathOf(stack));
        checkValue(value, pathOf(stack));
        const kept = value.split(";").map((s) => s.trim()).filter(Boolean).flatMap((decl) => {
          const at = decl.indexOf(":");
          const property = decl.slice(0, at).trim().toLowerCase();
          return at > 0 && STYLE_PROPERTIES.has(property) ? [`${property}:${rename(decl.slice(at + 1).trim())}`] : [];
        });
        if (kept.length) target.setAttribute("style", kept.join(";"));
        continue;
      }
      checkValue(value, pathOf(stack));
      if (attrName === "id") {
        if (ids.has(value)) throw new SkinError(`the id "${value}" is used twice`, pathOf(stack));
        ids.set(value, 0);
        elements.set(value, target);
        value = prefix + value;
      } else value = rename(value);
      target.setAttribute(attrName, value);
    }
    const counts = /* @__PURE__ */ new Map();
    for (const child of source2.childNodes) {
      if (child.nodeType === 1) {
        const n2 = (counts.get(child.localName) ?? 0) + 1;
        counts.set(child.localName, n2);
        const made = copy(child, [...stack, `${child.localName}[${n2}]`]);
        if (made) target.append(made);
      } else if (child.nodeType === 3 && (name === "text" || name === "tspan" || name === "title" || name === "desc")) {
        target.append(document2.createTextNode(child.nodeValue));
      }
    }
    const authorId = source2.getAttribute("id");
    if (authorId !== null && ids.has(authorId)) ids.set(authorId, target.children.length);
    return target;
  }
  const svg = copy(root, ["svg"]);
  return { svg, ids, elements };
}

// src/ui/HtmlSkinCss.js
var CSS_LIMITS = Object.freeze({ bytes: 64 * 1024, rules: 500 });
var PROPERTY = new RegExp("^(" + [
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "inset(-.*)?",
  "z-index",
  "flex(-.*)?",
  "grid(-.*)?",
  "(row-|column-)?gap",
  "align-.*",
  "justify-.*",
  "place-.*",
  "order",
  "width",
  "height",
  "min-.*",
  "max-.*",
  "margin(-.*)?",
  "padding(-.*)?",
  "box-sizing",
  "overflow(-.*)?",
  "color",
  "background-color",
  "border(-.*)?",
  "outline(-.*)?",
  "box-shadow",
  "accent-color",
  "color-scheme",
  "container-type",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "white-space"
].join("|") + ")$");
var ELEMENTS2 = /* @__PURE__ */ new Set(["section", "div", "span", "header", "footer", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "fieldset", "legend", "label", "output", "input", "select"]);
var DISPLAY = /* @__PURE__ */ new Set(["block", "inline", "inline-block", "flex", "grid", "contents"]);
var POSITION = /* @__PURE__ */ new Set(["static", "relative", "absolute"]);
var FAMILIES = /* @__PURE__ */ new Set(["sans-serif", "serif", "monospace", "system-ui", "ui-monospace", "ui-sans-serif", "ui-serif"]);
var FUNCTION_REFUSED = /\b(url|image-set|attr|env|var|expression)\s*\(/i;
var VALUE_CHARS = /^[A-Za-z0-9\s.,%#()+\-*/_]*$/;
var SELECTOR_CHARS = /^[A-Za-z0-9\s.#>:\-_[\]]+$/;
var MEDIA = /^\(\s*(min|max)-(width|height)\s*:\s*[^()]+\)(\s+and\s+\(\s*(min|max)-(width|height)\s*:\s*[^()]+\))*$/;
var COMPOUND = /^(?:[a-z][a-z0-9]*)?(?:\.[A-Za-z_-][\w-]*|#[A-Za-z_-][\w-]*|\[data-param(?:-name|-text|-help)?\]|:(?:hover|focus-visible|checked|first-child))*$/;
function blocks(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let i2 = 0; i2 < text.length; i2++) {
    const c3 = text[i2];
    if (c3 === "{") {
      if (depth === 0) open = i2;
      depth++;
    } else if (c3 === "}") {
      depth--;
      if (depth < 0) return { error: "an unmatched closing brace" };
      if (depth === 0) {
        out.push({ prelude: text.slice(start, open).trim(), body: text.slice(open + 1, i2) });
        start = i2 + 1;
      }
    } else if (c3 === ";" && depth === 0) {
      out.push({ prelude: text.slice(start, i2).trim(), body: null });
      start = i2 + 1;
    }
  }
  if (depth !== 0) return { error: "an unclosed brace" };
  if (text.slice(start).trim()) out.push({ prelude: text.slice(start).trim(), body: null });
  return out;
}
function declarations(selector, body, problems) {
  const kept = [];
  for (const raw of body.split(";")) {
    if (!raw.trim()) continue;
    const at = raw.indexOf(":");
    if (at < 0) {
      problems.push(`${selector}: a declaration with no colon`);
      continue;
    }
    const property = raw.slice(0, at).trim().toLowerCase();
    const value = raw.slice(at + 1).trim();
    if (property.startsWith("--")) {
      problems.push(`${selector}: custom property ${property} is refused`);
      continue;
    }
    if (!PROPERTY.test(property) || property.startsWith("border-image")) {
      problems.push(`${selector}: property ${property} is not allowed`);
      continue;
    }
    if (!VALUE_CHARS.test(value)) {
      problems.push(`${selector}: ${property} has a character a value may not hold (a quote, a backslash or !important, for one)`);
      continue;
    }
    if (FUNCTION_REFUSED.test(value)) {
      problems.push(`${selector}: ${property} uses a refused function`);
      continue;
    }
    if (property === "display" && !DISPLAY.has(value)) {
      problems.push(`${selector}: display ${value} is not allowed`);
      continue;
    }
    if (property === "position" && !POSITION.has(value)) {
      problems.push(`${selector}: position ${value} is not allowed`);
      continue;
    }
    if (property === "z-index" && !(/^\d+$/.test(value) && Number(value) <= 10)) {
      problems.push(`${selector}: z-index ${value} is not a whole number from 0 to 10`);
      continue;
    }
    if (property === "container-type" && value !== "inline-size") {
      problems.push(`${selector}: container-type ${value} is not allowed`);
      continue;
    }
    if (property === "font-family") {
      const bad = value.split(",").map((f) => f.trim().toLowerCase()).filter((f) => !FAMILIES.has(f));
      if (bad.length) {
        problems.push(`${selector}: font-family ${bad[0]} is not a generic family`);
        continue;
      }
    }
    if (property === "box-shadow") {
      const blur = Number(value.match(/-?\d+(\.\d+)?px\s+-?\d+(\.\d+)?px\s+(\d+(\.\d+)?)px/)?.[3] ?? 0);
      if (blur > 16) {
        problems.push(`${selector}: box-shadow blur ${blur}px is over 16px`);
        continue;
      }
    }
    kept.push(`${property}:${value}`);
  }
  return kept;
}
function selectorOf(selector, prefix, problems) {
  const refusedPseudo = selector.match(/(?<!:):([a-z-]+)/g)?.map((p) => p.slice(1)).find((name) => !/^(hover|focus-visible|checked|first-child)$/.test(name));
  if (refusedPseudo) {
    problems.push(`${selector}: :${refusedPseudo} is not allowed`);
    return null;
  }
  if (!SELECTOR_CHARS.test(selector)) {
    problems.push(`${selector}: a character a selector may not hold`);
    return null;
  }
  if (/::/.test(selector)) {
    problems.push(`${selector}: a pseudo-element is refused`);
    return null;
  }
  const parts = selector.trim().split(/\s*>\s*|\s+/).filter(Boolean);
  if (parts.length > 4) {
    problems.push(`${selector}: more than four compound parts`);
    return null;
  }
  for (const part of parts) {
    const type = part.match(/^[a-z][a-z0-9]*/)?.[0];
    if (COMPOUND.test(part) && (!type || ELEMENTS2.has(type))) continue;
    problems.push(`${selector}: ${part} is not an allowed selector`);
    return null;
  }
  return selector.trim().replace(/#([A-Za-z_-][\w-]*)/g, (_, id) => `#${prefix}${id}`);
}
function rules(text, prefix, problems, insideLayer, counter) {
  const parsed = blocks(text);
  if (parsed.error) {
    problems.push(parsed.error);
    return "";
  }
  let out = "";
  for (const { prelude, body } of parsed) {
    if (prelude.startsWith("@")) {
      const [name, ...rest] = prelude.slice(1).split(/\s+/);
      const argument = rest.join(" ");
      if (body === null) {
        problems.push(`@${name} is refused`);
        continue;
      }
      if (name === "layer") {
        if (insideLayer || argument !== "skin") {
          problems.push(`@layer ${argument} is not the one skin layer`);
          continue;
        }
        out += rules(body, prefix, problems, true, counter);
      } else if (name === "media" || name === "container") {
        if (!insideLayer) {
          problems.push(`@${name} sits outside @layer skin`);
          continue;
        }
        if (!MEDIA.test(argument)) {
          problems.push(`@${name} ${argument}: only width and height conditions are allowed`);
          continue;
        }
        out += `@${name} ${argument}{${rules(body, prefix, problems, true, counter)}}`;
      } else problems.push(`@${name} is refused`);
      continue;
    }
    counter.rules++;
    if (!insideLayer) {
      problems.push(`${prelude}: a rule outside @layer skin`);
      continue;
    }
    const selectors = prelude.split(",").map((s) => selectorOf(s.trim(), prefix, problems));
    const kept = declarations(prelude, body ?? "", problems);
    if (selectors.every(Boolean) && kept.length) out += `${selectors.join(",")}{${kept.join(";")}}`;
  }
  return out;
}
function checkCss(text, prefix) {
  const problems = [];
  if (text.length > CSS_LIMITS.bytes) return { css: "", problems: [`the stylesheet is ${text.length} bytes, over the ${CSS_LIMITS.bytes} limit`] };
  const counter = { rules: 0 };
  const inner = rules(text.replace(/\/\*[\s\S]*?\*\//g, ""), prefix, problems, false, counter);
  if (counter.rules > CSS_LIMITS.rules) problems.push(`${counter.rules} rules, over the ${CSS_LIMITS.rules} limit`);
  return { css: problems.length || !inner ? "" : `@layer skin{${inner}}`, problems };
}

// src/ui/HtmlSkin.js
var HTML_SKIN_LIMITS = Object.freeze({ bytes: 256 * 1024, elements: 2e3 });
var HtmlSkinError = class extends Error {
  constructor(problems) {
    super(problems.length === 1 ? problems[0] : `${problems[0]} (and ${problems.length - 1} more)`);
    this.name = "HtmlSkinError";
    this.problems = problems;
  }
};
function parseHtml(text, DOMParserClass = globalThis.DOMParser) {
  return new DOMParserClass().parseFromString(text, "text/html");
}
var ATTRIBUTES2 = /* @__PURE__ */ new Set(["class", "id", "lang", "title", "aria-hidden", "data-param", "data-param-name", "data-param-text", "data-param-help"]);
var PER_ELEMENT = { input: ["type"], label: ["for"] };
var BOUND = ["data-param", "data-param-name", "data-param-text"];
var KIND = { range: "dial", checkbox: "switch", select: "selector" };
function where(el) {
  const path = [];
  for (let node = el; node && node.tagName && node.tagName !== "BODY" && node.tagName !== "HTML"; node = node.parentElement) {
    const same = [...node.parentElement?.children ?? []].filter((s) => s.tagName === node.tagName);
    path.unshift(`${node.tagName.toLowerCase()}[${same.indexOf(node) + 1}]`);
  }
  return path.join(" > ") || "body";
}
function kindOf(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === "select") return "select";
  if (tag === "input") return el.getAttribute("type");
  return null;
}
function checkHtmlSkin(doc, ports, { prefix = "" } = {}) {
  const problems = [];
  const omitted = [];
  const bySymbol = new Map(ports.map((p) => [p.symbol, p]));
  const head = [...doc.head?.children ?? []];
  const body = doc.body;
  if (!body) return { problems: ["the skin has no body"], omitted, css: "" };
  for (const el of head) {
    const tag = el.tagName.toLowerCase();
    if (tag !== "style" && tag !== "title") problems.push(`head > ${tag} is not allowed`);
  }
  const elements = [...body.querySelectorAll("*")];
  if (elements.length + head.length > HTML_SKIN_LIMITS.elements) problems.push(`${elements.length} elements, over the ${HTML_SKIN_LIMITS.elements} limit`);
  const styles = [...head.filter((e) => e.tagName === "STYLE"), ...elements.filter((e) => e.tagName === "STYLE")];
  if (styles.length > 1) problems.push(`${styles.length} style elements, at most one is allowed`);
  const ids = new Set(elements.map((e) => e.getAttribute("id")).filter(Boolean));
  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    const at = where(el);
    if (tag === "style") continue;
    if (!ELEMENTS2.has(tag)) {
      problems.push(`${at}: <${tag}> is not an allowed element`);
      continue;
    }
    for (const attribute of el.getAttributeNames()) {
      if (!ATTRIBUTES2.has(attribute) && !(PER_ELEMENT[tag] ?? []).includes(attribute)) problems.push(`${at}: ${attribute} is not an allowed attribute on <${tag}>`);
    }
    if (tag === "label" && el.hasAttribute("for") && !ids.has(el.getAttribute("for"))) problems.push(`${at}: for="${el.getAttribute("for")}" names no element of this file`);
    if (tag === "input") {
      const type = el.getAttribute("type");
      if (type !== "range" && type !== "checkbox") problems.push(`${at}: <input type=${type}> is not allowed`);
    }
    if ((tag === "input" || tag === "select") && !el.hasAttribute("data-param")) problems.push(`${at}: <${tag}> without data-param is not allowed`);
    if (tag === "select" && el.querySelector("option")) problems.push(`${at}: <select> has option children, which the host makes`);
    for (const attribute of BOUND) {
      const symbol = el.getAttribute(attribute);
      if (symbol === null) continue;
      const port = bySymbol.get(symbol);
      if (!port) {
        omitted.push({ element: at, reason: `${attribute}="${symbol}" names no port of this plugin` });
        continue;
      }
      if (attribute === "data-param") {
        const kind = kindOf(el);
        if (KIND[kind] && KIND[kind] !== port.widget) omitted.push({ element: at, reason: `a ${kind} cannot set ${symbol}, which is a ${port.widget}` });
      }
    }
  }
  let css = "";
  if (styles.length === 1) {
    const checked = checkCss(styles[0].textContent, prefix);
    css = checked.css;
    for (const p of checked.problems) problems.push(`style: ${p}`);
  }
  return { problems, omitted, css };
}
var copyAttributes = (from, to, prefix) => {
  for (const name of from.getAttributeNames()) {
    if (name === "id" || name === "for") to.setAttribute(name, `${prefix}${from.getAttribute(name)}`);
    else to.setAttribute(name, from.getAttribute(name));
  }
};
function buildHtmlSkin(doc, profile, { document: document2, prefix, size = 0 }) {
  if (size > HTML_SKIN_LIMITS.bytes) throw new HtmlSkinError([`the skin is ${size} bytes, over the ${HTML_SKIN_LIMITS.bytes} limit`]);
  const { problems, omitted, css } = checkHtmlSkin(doc, profile.ports, { prefix });
  if (problems.length) throw new HtmlSkinError(problems);
  const bySymbol = new Map(profile.ports.map((p) => [p.symbol, p]));
  const dropped = new Set(omitted.map((o2) => o2.element));
  const controls = [];
  const texts = [];
  const names = [];
  const help = [];
  const root = document2.createElement("div");
  root.className = "html-skin";
  const copy = (from, into) => {
    for (const child of from.childNodes) {
      if (child.nodeType === 3) {
        into.append(document2.createTextNode(child.textContent));
        continue;
      }
      if (child.nodeType !== 1 || child.tagName === "STYLE") continue;
      const tag = child.tagName.toLowerCase();
      const at = where(child);
      if (dropped.has(at) && child.hasAttribute("data-param")) continue;
      const made = document2.createElement(tag);
      copyAttributes(child, made, prefix);
      if (dropped.has(at)) for (const a2 of BOUND) made.removeAttribute(a2);
      into.append(made);
      const symbol = child.getAttribute("data-param");
      if (symbol !== null && bySymbol.has(symbol)) controls.push({ element: made, port: bySymbol.get(symbol), kind: kindOf(child) });
      if (child.hasAttribute("data-param-text") && !dropped.has(at)) texts.push({ element: made, symbol: child.getAttribute("data-param-text") });
      if (child.hasAttribute("data-param-name") && !dropped.has(at)) names.push({ element: made, symbol: child.getAttribute("data-param-name") });
      if (child.hasAttribute("data-param-help")) help.push(made);
      if (tag !== "select" && tag !== "input") copy(child, made);
    }
  };
  copy(doc.body, root);
  return { root, css, controls, texts, names, help, omitted };
}

// src/host/SkinLoader.js
var SkinLoadError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "SkinLoadError";
  }
};
async function loadSkin(profile, { fetchVerified, parseTurtle, parseSvg: parseSvg2, parseHtml: parseHtml2 }) {
  if (!profile.skin) throw new SkinLoadError("the profile declares no skin");
  const decoder = new TextDecoder();
  if (profile.skin.mediaType === "text/html") {
    const bytes = await fetchVerified(profile.skin, { kind: "skin" });
    let document2;
    try {
      document2 = parseHtml2(decoder.decode(bytes));
    } catch (cause) {
      throw new SkinLoadError(`the skin at ${profile.skin.location}: ${cause.message}`, { cause });
    }
    return { kind: "html", document: document2, size: bytes.byteLength };
  }
  const skinBytes = await fetchVerified(profile.skin, { kind: "skin" });
  const skinIri = profile.skin.location;
  let skin;
  try {
    skin = readSkin(await parseTurtle(decoder.decode(skinBytes), skinIri));
  } catch (cause) {
    throw new SkinLoadError(`the skin at ${skinIri} could not be read: ${cause.message}`, { cause });
  }
  if (!skin.artwork?.location || !skin.artwork.integrity) {
    throw new SkinLoadError(`the skin at ${skinIri} names no artwork with a location and a digest`);
  }
  const directory = (iri4) => iri4.slice(0, iri4.lastIndexOf("/") + 1);
  const artwork = skinIri.startsWith("data:") ? skin.artwork : { ...skin.artwork, location: rebaseLocation(skin.artwork.location, directory(skin.iri), directory(skinIri)) };
  const artBytes = await fetchVerified(artwork, { kind: "skin artwork" });
  let doc;
  try {
    doc = parseSvg2(decoder.decode(artBytes));
  } catch (cause) {
    throw new SkinLoadError(`the artwork at ${artwork.location}: ${cause.message}`, { cause });
  }
  return { skin, artwork: { doc, size: artBytes.byteLength } };
}
function prepareSkin(loaded, profile, { document: document2, prefix }) {
  if (loaded.kind === "html") {
    const built2 = buildHtmlSkin(loaded.document, profile, { document: document2, prefix, size: loaded.size });
    return { ...built2, kind: "html", omitted: built2.omitted.map((o2) => ({ control: o2.element, reason: o2.reason })) };
  }
  const built = buildArtwork(loaded.artwork.doc, { document: document2, prefix, size: loaded.artwork.size });
  const { keep, omitted } = checkSkin(loaded.skin, { ids: built.ids }, profile.ports);
  return { svg: built.svg, elements: built.elements, controls: keep, omitted };
}

// node_modules/n3/src/N3Lexer.js
var import_buffer = __toESM(require_buffer());

// node_modules/n3/src/IRIs.js
var RDF2 = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
var XSD = "http://www.w3.org/2001/XMLSchema#";
var SWAP = "http://www.w3.org/2000/10/swap/";
var IRIs_default = {
  xsd: {
    decimal: `${XSD}decimal`,
    boolean: `${XSD}boolean`,
    dateTime: `${XSD}dateTime`,
    double: `${XSD}double`,
    integer: `${XSD}integer`,
    string: `${XSD}string`
  },
  rdf: {
    type: `${RDF2}type`,
    nil: `${RDF2}nil`,
    first: `${RDF2}first`,
    rest: `${RDF2}rest`,
    langString: `${RDF2}langString`,
    dirLangString: `${RDF2}dirLangString`,
    reifies: `${RDF2}reifies`
  },
  owl: {
    sameAs: "http://www.w3.org/2002/07/owl#sameAs"
  },
  r: {
    forSome: `${SWAP}reify#forSome`,
    forAll: `${SWAP}reify#forAll`
  },
  log: {
    implies: `${SWAP}log#implies`,
    isImpliedBy: `${SWAP}log#isImpliedBy`
  }
};

// node_modules/n3/src/N3Lexer.js
var { xsd: xsd2 } = IRIs_default;
var SPACE = 32;
var TAB = 9;
var LF = 10;
var CR = 13;
var HASH = 35;
var escapeSequence = /\\u([a-fA-F0-9]{4})|\\U([a-fA-F0-9]{8})|\\([^])/g;
var stringEscapeReplacements = {
  "\\": "\\",
  "'": "'",
  '"': '"',
  "n": "\n",
  "r": "\r",
  "t": "	",
  "f": "\f",
  "b": "\b"
};
var localNameEscapeReplacements = {
  "_": "_",
  "~": "~",
  ".": ".",
  "-": "-",
  "!": "!",
  "$": "$",
  "&": "&",
  "'": "'",
  "(": "(",
  ")": ")",
  "*": "*",
  "+": "+",
  ",": ",",
  ";": ";",
  "=": "=",
  "/": "/",
  "?": "?",
  "#": "#",
  "@": "@",
  "%": "%"
};
var illegalIriChars = /[\x00-\x20<>\\"\{\}\|\^\`]/;
function isValidCodePoint(charCode) {
  return charCode <= 1114111 && (charCode < 55296 || charCode > 57343);
}
var lineModeRegExps = {
  _iri: true,
  _unescapedIri: true,
  _simpleQuotedString: true,
  _langcode: true,
  _blank: true,
  _commentLine: true,
  _whitespace: true
};
var invalidRegExp = /$0^/;
var N3Lexer = class {
  constructor(options) {
    this._iri = /^<((?:[^ <>{}\\]|\\[uU])+)>[ \t]*/;
    this._unescapedIri = /^<([^\x00-\x20<>\\"\{\}\|\^\`]*)>[ \t]*/;
    this._simpleQuotedString = /^"([^"\\\r\n]*)"(?=[^"])/;
    this._simpleApostropheString = /^'([^'\\\r\n]*)'(?=[^'])/;
    this._langcode = /^@([a-z]+(?:-[a-z0-9]+)*)(?=[^a-z0-9])/i;
    this._prefix = /^((?:[A-Za-z\xc0-\xd6\xd8-\xf6\xf8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])(?:\.?[\-0-9A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])*)?:(?=[#\s<])/;
    this._prefixed = /^((?:[A-Za-z\xc0-\xd6\xd8-\xf6\xf8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])(?:\.?[\-0-9A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])*)?:((?:(?:[0-:A-Z_a-z\xc0-\xd6\xd8-\xf6\xf8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff]|%[0-9a-fA-F]{2}|\\[!#-\/;=?\-@_~])(?:(?:[\.\-0-:A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff]|%[0-9a-fA-F]{2}|\\[!#-\/;=?\-@_~])*(?:[\-0-:A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff]|%[0-9a-fA-F]{2}|\\[!#-\/;=?\-@_~]))?)?)(?:[ \t]+|(?=\.?[,;!\^\s#()\[\]\{\}"'<>]))/;
    this._variable = /^\?(?:(?:[A-Z_a-z\xc0-\xd6\xd8-\xf6\xf8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])(?:[\-0-:A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])*)(?=[.,;!\^\s#()\[\]\{\}"'<>])/;
    this._blank = /^_:((?:[0-9A-Z_a-z\xc0-\xd6\xd8-\xf6\xf8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])(?:\.?[\-0-9A-Z_a-z\xb7\xc0-\xd6\xd8-\xf6\xf8-\u037d\u037f-\u1fff\u200c\u200d\u203f\u2040\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]|[\ud800-\udb7f][\udc00-\udfff])*)(?:[ \t]+|(?=\.?[,;:!\^\s#()\[\]\{\}"'<>]))/;
    this._number = /^[\-+]?(?:(\d+\.\d*|\.?\d+)[eE][\-+]?|\d*(\.)?)\d+(?=\.?[,;:!\^\s#()\[\]\{\}"'<>])/;
    this._boolean = /^(?:true|false)(?=[.,;!\^\s#()\[\]\{\}"'<>])/;
    this._atKeyword = /^@[a-z]+(?=[\s#<:])/i;
    this._keyword = /^(?:PREFIX|BASE|VERSION|GRAPH)(?=[\s#<])/i;
    this._n3Verb = /^(?:has|is|of)(?=[\s#()\[\]\{\}"'<>?_+\-0-9])/;
    this._n3Id = /^id(?=[\s#<])/;
    this._shortPredicates = /^a(?=[\s#()\[\]\{\}"'<>])/;
    this._commentLine = /^[ \t]*#([^\n\r]*)(?:\r\n|\n|\r)([ \t]*)/;
    this._whitespace = /^[ \t]+/;
    options = options || {};
    this._isImpliedBy = options.isImpliedBy;
    if (this._lineMode = !!options.lineMode) {
      this._n3Mode = false;
      for (const key in this) {
        if (!(key in lineModeRegExps) && this[key] instanceof RegExp)
          this[key] = invalidRegExp;
      }
    } else {
      this._n3Mode = options.n3 !== false;
    }
    this.comments = !!options.comments;
    this._literalClosingPos = 0;
  }
  // ## Private methods
  // ### `_tokenizeToEnd` tokenizes as for as possible, emitting tokens through the callback
  _tokenizeToEnd(callback, inputFinished) {
    let input = this._input;
    let currentLineLength = this._linePosition + input.length;
    while (true) {
      while (true) {
        let charCode = input.charCodeAt(0), separatorLength = 0;
        if (charCode === SPACE || charCode === TAB) {
          const next = input.charCodeAt(1);
          separatorLength = next === SPACE || next === TAB ? this._whitespace.exec(input)[0].length : 1;
          charCode = input.charCodeAt(separatorLength);
        }
        if (charCode === HASH) {
          const comment = this._commentLine.exec(input);
          if (comment) {
            const commentLength = comment[0].length;
            if (!inputFinished && commentLength === input.length && input.charCodeAt(commentLength - 1) === CR) {
              this._linePosition = currentLineLength - input.length;
              return this._input = input;
            }
            if (this.comments)
              emitComment(comment[1], this._line, separatorLength);
            input = input.slice(commentLength);
            currentLineLength = input.length + comment[2].length;
            this._line++;
          } else {
            input = input.slice(separatorLength);
            if (!inputFinished) {
              this._linePosition = currentLineLength - input.length;
              return this._input = input;
            }
            if (this.comments)
              emitComment(input.slice(1), this._line, 0);
            input = "";
            break;
          }
        } else if (charCode === LF || charCode === CR) {
          if (!inputFinished && charCode === CR && separatorLength + 1 === input.length) {
            this._linePosition = currentLineLength - input.length;
            return this._input = input;
          }
          separatorLength += charCode === CR && input.charCodeAt(separatorLength + 1) === LF ? 2 : 1;
          let indentationLength = 0;
          const next = input.charCodeAt(separatorLength);
          if (next === SPACE || next === TAB) {
            const following = input.charCodeAt(separatorLength + 1);
            indentationLength = following === SPACE || following === TAB ? this._whitespace.exec(input.slice(separatorLength))[0].length : 1;
          }
          input = input.slice(separatorLength + indentationLength);
          currentLineLength = input.length + indentationLength;
          this._line++;
        } else {
          if (separatorLength !== 0)
            input = input.slice(separatorLength);
          break;
        }
      }
      if (input.length === 0) {
        if (inputFinished) {
          input = null;
          emitToken("eof", "", "", this._line, 0);
        }
        this._linePosition = currentLineLength;
        return this._input = input;
      }
      const line = this._line, firstChar = input[0];
      let type = "", value = "", prefix = "", match = null, matchLength = 0, lexicalLength = 0, finalLineLength = 0, inconclusive = false;
      switch (firstChar) {
        case "^":
          if (input.length < 3)
            break;
          else if (input[1] === "^") {
            this._previousMarker = "^^";
            input = input.slice(2);
            if (input[0] !== "<") {
              inconclusive = true;
              break;
            }
          } else {
            if (this._n3Mode) {
              matchLength = 1;
              type = "^";
            }
            break;
          }
        // Fall through in case the type is an IRI
        case "<":
          if (match = this._unescapedIri.exec(input)) {
            type = "IRI", value = match[1];
            lexicalLength = match[1].length + 2;
          } else if (match = this._iri.exec(input)) {
            value = this._unescape(match[1], stringEscapeReplacements);
            if (value === null || illegalIriChars.test(value))
              return reportSyntaxError(this);
            type = "IRI";
            lexicalLength = match[1].length + 2;
          } else if (input.length > 2 && input[1] === "<" && input[2] === "(")
            type = "<<(", matchLength = 3;
          else if (!this._lineMode && input.length > (inputFinished ? 1 : 2) && input[1] === "<")
            type = "<<", matchLength = 2;
          else if (this._n3Mode && input.length > 1 && input[1] === "=") {
            matchLength = 2;
            if (this._isImpliedBy) type = "abbreviation", value = "<";
            else type = "inverse", value = ">";
          } else if (this._n3Mode && input.length > 1 && input[1] === "-")
            type = "inversePredicate", matchLength = 2;
          break;
        case ">":
          if (input.length > 1 && input[1] === ">")
            type = ">>", matchLength = 2;
          break;
        case "_":
          if ((match = this._blank.exec(input)) || inputFinished && (match = this._blank.exec(`${input} `))) {
            type = "blank", prefix = "_", value = match[1];
            lexicalLength = match[1].length + 2;
          }
          break;
        case '"':
          if (match = this._simpleQuotedString.exec(input))
            value = match[1];
          else {
            ({ value, matchLength, finalLineLength } = this._parseLiteral(input));
            if (value === null)
              return reportSyntaxError(this);
          }
          if (match !== null || matchLength !== 0) {
            type = "literal";
            this._literalClosingPos = 0;
          }
          break;
        case "'":
          if (!this._lineMode) {
            if (match = this._simpleApostropheString.exec(input))
              value = match[1];
            else {
              ({ value, matchLength, finalLineLength } = this._parseLiteral(input));
              if (value === null)
                return reportSyntaxError(this);
            }
            if (match !== null || matchLength !== 0) {
              type = "literal";
              this._literalClosingPos = 0;
            }
          }
          break;
        case "?":
          if (this._n3Mode && (match = this._variable.exec(input)))
            type = "var", value = match[0];
          break;
        case "@":
          if (this._previousMarker === "literal" && (match = this._langcode.exec(input)) && match[1] !== "version") {
            if (!inputFinished && input[match[0].length] === "-" && input[match[0].length + 1] !== "-")
              match = null;
            else
              type = "langcode", value = match[1];
          } else if (match = this._atKeyword.exec(input))
            type = match[0];
          break;
        case ".":
          if (input.length === 1 ? inputFinished : input[1] < "0" || input[1] > "9") {
            type = ".";
            matchLength = 1;
            break;
          }
        // Fall through to numerical case (could be a decimal dot)
        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7":
        case "8":
        case "9":
        case "+":
        case "-":
          if (input[1] === "-") {
            if (this._previousMarker === "langcode") {
              if (input.startsWith("--ltr"))
                type = "dircode", value = "ltr", matchLength = 5;
              else if (input.startsWith("--rtl"))
                type = "dircode", value = "rtl", matchLength = 5;
            }
            break;
          }
          if (match = this._number.exec(input) || inputFinished && (match = this._number.exec(`${input} `))) {
            type = "literal", value = match[0];
            prefix = typeof match[1] === "string" ? xsd2.double : typeof match[2] === "string" ? xsd2.decimal : xsd2.integer;
          }
          break;
        case "B":
        case "b":
        case "p":
        case "P":
        case "G":
        case "g":
        case "V":
        case "v":
          if (match = this._keyword.exec(input))
            type = match[0].toUpperCase();
          else
            inconclusive = true;
          break;
        case "f":
        case "t":
          if (this._boolean.test(input))
            type = "literal", value = firstChar === "t" ? "true" : "false", prefix = xsd2.boolean, matchLength = value.length;
          else
            inconclusive = true;
          break;
        case "a":
          if (this._shortPredicates.test(input))
            type = "abbreviation", value = "a", matchLength = 1;
          else
            inconclusive = true;
          break;
        case "h":
        case "o":
          if (this._n3Mode && (match = this._matchN3Verb(input, inputFinished)))
            type = match[0];
          else
            inconclusive = true;
          break;
        case "i":
          if (this._n3Mode && this._n3Id.test(input))
            type = "id", matchLength = 2;
          else if (this._n3Mode && (match = this._matchN3Verb(input, inputFinished)))
            type = match[0];
          else
            inconclusive = true;
          break;
        case "=":
          if (this._n3Mode && input.length > 1) {
            type = "abbreviation";
            if (input[1] !== ">")
              matchLength = 1, value = "=";
            else
              matchLength = 2, value = ">";
          }
          break;
        case "!":
          if (!this._n3Mode)
            break;
        case ")":
          if (!inputFinished && (input.length === 1 || input.length === 2 && input[1] === ">")) {
            break;
          }
          if (input.length > 2 && input[1] === ">" && input[2] === ">") {
            type = ")>>", matchLength = 3;
            break;
          }
        case ",":
        case ";":
        case "[":
        case "]":
        case "(":
        case "}":
        case "~":
          if (!this._lineMode) {
            matchLength = 1;
            type = firstChar;
          }
          break;
        case "{":
          if (!this._lineMode && input.length >= 2) {
            if (input[1] === "|")
              type = "{|", matchLength = 2;
            else
              type = firstChar, matchLength = 1;
          }
          break;
        case "|":
          if (input.length >= 2 && input[1] === "}")
            type = "|}", matchLength = 2;
          break;
        default:
          inconclusive = true;
      }
      if (inconclusive) {
        if ((this._previousMarker === "@prefix" || this._previousMarker === "PREFIX") && (match = this._prefix.exec(input)))
          type = "prefix", value = match[1] || "";
        else if ((match = this._prefixed.exec(input)) || inputFinished && (match = this._prefixed.exec(`${input} `))) {
          type = "prefixed", prefix = match[1] || "";
          value = this._unescape(match[2], localNameEscapeReplacements);
          lexicalLength = prefix.length + match[2].length + 1;
        }
      }
      if (this._previousMarker === "^^") {
        switch (type) {
          case "prefixed":
            type = "type";
            break;
          case "IRI":
            type = "typeIRI";
            break;
          default:
            type = "";
        }
      }
      if (!type) {
        if (inputFinished || !/^'''|^"""/.test(input) && /\n|\r/.test(input))
          return reportSyntaxError(this);
        else {
          this._linePosition = currentLineLength - input.length;
          return this._input = input;
        }
      }
      const length = matchLength || match[0].length;
      let token;
      if (finalLineLength) {
        token = {
          type,
          value,
          prefix,
          line,
          start: currentLineLength - input.length,
          end: finalLineLength,
          endLine: this._line
        };
        callback(null, token);
      } else
        token = emitToken(type, value, prefix, line, lexicalLength || length);
      this.previousToken = token;
      this._previousMarker = type;
      input = input.slice(length);
      if (finalLineLength)
        currentLineLength = input.length + finalLineLength;
    }
    function emitComment(value, line, offset) {
      const start = currentLineLength - input.length + offset;
      callback(null, {
        type: "comment",
        value,
        prefix: "",
        line,
        start,
        end: start + value.length + 1
      });
    }
    function emitToken(type, value, prefix, line, length) {
      const start = input ? currentLineLength - input.length : currentLineLength;
      const end = start + length;
      const token = { type, value, prefix, line, start, end };
      callback(null, token);
      return token;
    }
    function reportSyntaxError(self2) {
      callback(self2._syntaxError(/^\S*/.exec(input)[0]));
    }
  }
  // ### `_matchN3Verb` matches an N3 verb unless the input is a longer prefixed name
  _matchN3Verb(input, inputFinished) {
    const verb = this._n3Verb.exec(input);
    if (!verb)
      return null;
    const next = input[verb[0].length];
    if (next !== "-" && next !== "_" && (next < "0" || next > "9"))
      return verb;
    if (this._prefixed.exec(input) || this._prefixed.exec(`${input} `))
      return null;
    if (!inputFinished) {
      const prefix = this._prefix.exec(`${input}: `);
      if (prefix)
        return null;
    }
    return verb;
  }
  // ### `_unescape` replaces N3 escape codes by their corresponding characters,
  // allowing only the fixed escape sequences from the given replacement table
  _unescape(item, replacements) {
    if (item.indexOf("\\") < 0)
      return item;
    let invalid = false;
    const replaced = item.replace(escapeSequence, (sequence, unicode4, unicode8, escapedChar) => {
      if (typeof unicode4 === "string") {
        const charCode = Number.parseInt(unicode4, 16);
        if (!isValidCodePoint(charCode)) {
          invalid = true;
          return "";
        }
        return String.fromCharCode(charCode);
      }
      if (typeof unicode8 === "string") {
        let charCode = Number.parseInt(unicode8, 16);
        if (!isValidCodePoint(charCode)) {
          invalid = true;
          return "";
        }
        return charCode <= 65535 ? String.fromCharCode(Number.parseInt(unicode8, 16)) : String.fromCharCode(55296 + ((charCode -= 65536) >> 10), 56320 + (charCode & 1023));
      }
      if (escapedChar in replacements)
        return replacements[escapedChar];
      invalid = true;
      return "";
    });
    return invalid ? null : replaced;
  }
  // ### `_parseLiteral` parses a literal into an unescaped value
  _parseLiteral(input) {
    if (input.length >= 3) {
      const quote = input[0];
      const openingLength = input[1] === quote && input[2] === quote ? 3 : 1;
      let opening = quote;
      if (openingLength === 3)
        opening = quote === '"' ? '"""' : "'''";
      let closingPos = Math.max(this._literalClosingPos, openingLength);
      while ((closingPos = input.indexOf(opening, closingPos)) > 0) {
        let backslashCount = 0;
        while (input[closingPos - backslashCount - 1] === "\\")
          backslashCount++;
        if (backslashCount % 2 === 0) {
          const raw = input.substring(openingLength, closingPos), lines = raw.split(/\r\n|\r|\n/), lineCount = lines.length - 1;
          const matchLength = closingPos + openingLength;
          if (openingLength === 1 && lineCount !== 0 || openingLength === 3 && this._lineMode)
            break;
          this._line += lineCount;
          const finalLineLength = lineCount === 0 ? 0 : lines[lines.length - 1].length + openingLength;
          return { value: this._unescape(raw, stringEscapeReplacements), matchLength, finalLineLength };
        }
        closingPos++;
      }
      this._literalClosingPos = input.length - openingLength + 1;
    }
    return { value: "", matchLength: 0, finalLineLength: 0 };
  }
  // ### `_syntaxError` creates a syntax error for the given issue
  _syntaxError(issue) {
    this._input = null;
    const err = new Error(`Unexpected "${issue}" on line ${this._line}.`);
    err.context = {
      token: void 0,
      line: this._line,
      previousToken: this.previousToken
    };
    return err;
  }
  // ### Strips off any starting UTF BOM mark.
  _readStartingBom(input) {
    if (input.startsWith("\uFEFF")) {
      this._linePosition = 1;
      return input.slice(1);
    }
    return input;
  }
  // ## Public methods
  // ### `tokenize` starts the transformation of an N3 document into an array of tokens.
  // The input can be a string or a stream.
  // Token ranges use one-based lines and zero-based, end-exclusive UTF-16 columns.
  // Separator whitespace counts towards the next token's start, outside either range.
  // Multiline tokens also have endLine; their end column is relative to that line.
  tokenize(input, callback) {
    const tokenization = this._tokenization = {};
    this._line = 1;
    this._linePosition = 0;
    this._previousMarker = void 0;
    this.previousToken = void 0;
    this._literalClosingPos = 0;
    this._input = void 0;
    if (typeof input === "string") {
      this._input = this._readStartingBom(input);
      if (typeof callback === "function")
        queueMicrotask(() => {
          if (this._tokenization === tokenization)
            this._tokenizeToEnd(callback, true);
        });
      else {
        const tokens = [];
        let error2;
        this._tokenizeToEnd((e, t) => e ? error2 = e : tokens.push(t), true);
        if (error2) throw error2;
        return tokens;
      }
    } else {
      this._pendingBuffer = null;
      if (typeof input.setEncoding === "function")
        input.setEncoding("utf8");
      input.on("data", (data) => {
        if (this._tokenization === tokenization && this._input !== null && data.length !== 0) {
          if (this._pendingBuffer) {
            data = import_buffer.Buffer.concat([this._pendingBuffer, data]);
            this._pendingBuffer = null;
          }
          if (data[data.length - 1] & 128) {
            this._pendingBuffer = data;
          } else {
            if (typeof this._input === "undefined")
              this._input = this._readStartingBom(typeof data === "string" ? data : data.toString());
            else
              this._input += data;
            this._tokenizeToEnd(callback, false);
          }
        }
      });
      input.on("end", () => {
        if (this._tokenization === tokenization && typeof this._input === "string")
          this._tokenizeToEnd(callback, true);
      });
      input.on("error", (error2) => {
        if (this._tokenization === tokenization)
          callback(error2);
      });
    }
  }
};

// node_modules/n3/src/N3DataFactory.js
var { rdf, xsd: xsd3 } = IRIs_default;
var DEFAULTGRAPH;
var _blankNodeCounter = 0;
var DataFactory2 = {
  namedNode: namedNode3,
  blankNode: blankNode3,
  variable: variable2,
  literal: literal3,
  defaultGraph: defaultGraph2,
  quad: quad2,
  triple: quad2,
  fromTerm: fromTerm2,
  fromQuad
};
var N3DataFactory_default = DataFactory2;
var Term = class _Term {
  constructor(id) {
    this.id = id;
  }
  // ### The value of this term
  get value() {
    return this.id;
  }
  // ### Returns whether this object represents the same term as the other
  equals(other) {
    if (other instanceof _Term)
      return this.id === other.id;
    return !!other && this.termType === other.termType && this.value === other.value;
  }
  // ### Implement hashCode for Immutable.js, since we implement `equals`
  // https://immutable-js.com/docs/v4.0.0/ValueObject/#hashCode()
  hashCode() {
    return 0;
  }
  // ### Returns a plain object representation of this term
  toJSON() {
    return {
      termType: this.termType,
      value: this.value
    };
  }
};
var NamedNode2 = class extends Term {
  // ### Creates a named node
  /**
   * @deprecated Create named nodes through a data factory instead
   * (`DataFactory.namedNode(iri)`), so that term validation can be applied;
   * the constructor assumes an already-validated IRI.
   */
  constructor(iri4) {
    super(iri4);
  }
  // ### The term type of this term
  get termType() {
    return "NamedNode";
  }
};
var Literal2 = class _Literal extends Term {
  // ### Creates a literal
  /**
   * @deprecated Create literals through a data factory instead
   * (`DataFactory.literal(value, languageOrDatatype)`), so that term
   * validation can be applied; the constructor takes the internal
   * id representation and assumes it is already valid.
   */
  constructor(id) {
    super(id);
  }
  // ### The term type of this term
  get termType() {
    return "Literal";
  }
  // ### The text value of this literal
  get value() {
    return this.id.substring(1, this.id.lastIndexOf('"'));
  }
  // ### The language of this literal
  get language() {
    const id = this.id;
    let atPos = id.lastIndexOf('"') + 1;
    const dirPos = id.lastIndexOf("--");
    return atPos < id.length && id[atPos++] === "@" ? (dirPos > atPos ? id.substr(0, dirPos) : id).substr(atPos).toLowerCase() : "";
  }
  // ### The direction of this literal
  get direction() {
    const id = this.id;
    const endPos = id.lastIndexOf('"');
    const dirPos = id.lastIndexOf("--");
    return dirPos > endPos && dirPos + 2 < id.length ? id.substr(dirPos + 2).toLowerCase() : "";
  }
  // ### The datatype IRI of this literal
  get datatype() {
    return new NamedNode2(this.datatypeString);
  }
  // ### The datatype string of this literal
  get datatypeString() {
    const id = this.id, dtPos = id.lastIndexOf('"') + 1;
    const char = dtPos < id.length ? id[dtPos] : "";
    return char === "^" ? id.substr(dtPos + 2) : (
      // If "@" follows, return rdf:langString or rdf:dirLangString; xsd:string otherwise
      char !== "@" ? xsd3.string : id.indexOf("--", dtPos) > 0 ? rdf.dirLangString : rdf.langString
    );
  }
  // ### Returns whether this object represents the same term as the other
  equals(other) {
    if (other instanceof _Literal)
      return this.id === other.id;
    return !!other && !!other.datatype && this.termType === other.termType && this.value === other.value && this.language === other.language && (this.direction === other.direction || this.direction === "" && !other.direction) && this.datatype.value === other.datatype.value;
  }
  toJSON() {
    return {
      termType: this.termType,
      value: this.value,
      language: this.language,
      direction: this.direction,
      datatype: { termType: "NamedNode", value: this.datatypeString }
    };
  }
};
var BlankNode2 = class extends Term {
  // ### Creates a blank node
  /**
   * @deprecated Create blank nodes through a data factory instead
   * (`DataFactory.blankNode(name)`), so that term validation can be applied;
   * the constructor assumes an already-validated name.
   */
  constructor(name) {
    super(`_:${name}`);
  }
  // ### The term type of this term
  get termType() {
    return "BlankNode";
  }
  // ### The name of this blank node
  get value() {
    return this.id.substr(2);
  }
};
var Variable2 = class extends Term {
  // ### Creates a variable
  /**
   * @deprecated Create variables through a data factory instead
   * (`DataFactory.variable(name)`), so that term validation can be applied;
   * the constructor assumes an already-validated name.
   */
  constructor(name) {
    super(`?${name}`);
  }
  // ### The term type of this term
  get termType() {
    return "Variable";
  }
  // ### The name of this variable
  get value() {
    return this.id.substr(1);
  }
};
var DefaultGraph2 = class extends Term {
  // ### Creates the default graph
  /**
   * @deprecated Obtain the default graph through a data factory instead
   * (`DataFactory.defaultGraph()`).
   */
  constructor() {
    super("");
    return DEFAULTGRAPH || this;
  }
  // ### The term type of this term
  get termType() {
    return "DefaultGraph";
  }
  // ### Returns whether this object represents the same term as the other
  equals(other) {
    return this === other || !!other && this.termType === other.termType;
  }
};
DEFAULTGRAPH = new DefaultGraph2();
var Quad2 = class extends Term {
  // ### Creates a quad
  /**
   * @deprecated Create quads through a data factory instead
   * (`DataFactory.quad(subject, predicate, object, graph)`), so that term
   * validation can be applied; the constructor assumes already-validated terms.
   */
  constructor(subject, predicate, object, graph) {
    super("");
    this._subject = subject;
    this._predicate = predicate;
    this._object = object;
    this._graph = graph || DEFAULTGRAPH;
  }
  // ### The term type of this term
  get termType() {
    return "Quad";
  }
  get subject() {
    return this._subject;
  }
  get predicate() {
    return this._predicate;
  }
  get object() {
    return this._object;
  }
  get graph() {
    return this._graph;
  }
  // ### Returns a plain object representation of this quad
  toJSON() {
    return {
      termType: this.termType,
      subject: this._subject.toJSON(),
      predicate: this._predicate.toJSON(),
      object: this._object.toJSON(),
      graph: this._graph.toJSON()
    };
  }
  // ### Returns whether this object represents the same quad as the other
  equals(other) {
    return !!other && this._subject.equals(other.subject) && this._predicate.equals(other.predicate) && this._object.equals(other.object) && this._graph.equals(other.graph);
  }
};
function namedNode3(iri4) {
  return new NamedNode2(iri4);
}
function blankNode3(name) {
  return new BlankNode2(name || `n3-${_blankNodeCounter++}`);
}
function literal3(value, languageOrDataType) {
  if (typeof languageOrDataType === "string")
    return new Literal2(`"${value}"@${languageOrDataType.toLowerCase()}`);
  if (languageOrDataType !== void 0 && !("termType" in languageOrDataType)) {
    return new Literal2(`"${value}"@${languageOrDataType.language.toLowerCase()}${languageOrDataType.direction ? `--${languageOrDataType.direction.toLowerCase()}` : ""}`);
  }
  let datatype = languageOrDataType ? languageOrDataType.value : "";
  if (datatype === "") {
    if (typeof value === "boolean")
      datatype = xsd3.boolean;
    else if (typeof value === "number") {
      if (Number.isFinite(value))
        datatype = Number.isInteger(value) ? xsd3.integer : xsd3.double;
      else {
        datatype = xsd3.double;
        if (!Number.isNaN(value))
          value = value > 0 ? "INF" : "-INF";
      }
    } else if (value instanceof Date && !Number.isNaN(value.getTime())) {
      datatype = xsd3.dateTime;
      value = value.toISOString();
    }
  }
  return datatype === "" || datatype === xsd3.string ? new Literal2(`"${value}"`) : new Literal2(`"${value}"^^${datatype}`);
}
function variable2(name) {
  return new Variable2(name);
}
function defaultGraph2() {
  return DEFAULTGRAPH;
}
function quad2(subject, predicate, object, graph) {
  return new Quad2(subject, predicate, object, graph);
}
function fromTerm2(term2) {
  if (term2 instanceof Term)
    return term2;
  switch (term2.termType) {
    case "NamedNode":
      return namedNode3(term2.value);
    case "BlankNode":
      return blankNode3(term2.value);
    case "Variable":
      return variable2(term2.value);
    case "DefaultGraph":
      return DEFAULTGRAPH;
    case "Literal":
      return literal3(term2.value, term2.language || term2.datatype);
    case "Quad":
      return fromQuad(term2);
    default:
      throw new Error(`Unexpected termType: ${term2.termType}`);
  }
}
function fromQuad(inQuad) {
  if (inQuad instanceof Quad2)
    return inQuad;
  if (inQuad.termType !== "Quad")
    throw new Error(`Unexpected termType: ${inQuad.termType}`);
  return quad2(fromTerm2(inQuad.subject), fromTerm2(inQuad.predicate), fromTerm2(inQuad.object), fromTerm2(inQuad.graph));
}

// node_modules/n3/src/N3Parser.js
var blankNodePrefix = 0;
var N3Parser = class _N3Parser {
  constructor(options) {
    this._contextStack = [];
    this._graph = null;
    options = options || {};
    this._setBase(options.baseIRI);
    options.factory && initDataFactory(this, options.factory);
    const format = typeof options.format === "string" ? options.format.match(/\w*$/)[0].toLowerCase() : "", isTurtle = /turtle/.test(format), isTriG = /trig/.test(format), isNTriples = /triple/.test(format), isNQuads = /quad/.test(format), isN3 = this._n3Mode = /n3/.test(format), isLineMode = isNTriples || isNQuads;
    this._emitCurrent = this._emit;
    if (isN3) {
      this._createQuad = this._createQuadInDirection;
      this._emit = this._emitInDirection;
      this._emitCurrent = this._emitCurrentInDirection;
    }
    if (!(this._supportsNamedGraphs = !(isTurtle || isN3)))
      this._readPredicateOrNamedGraph = this._readPredicate;
    this._supportsQuads = !(isTurtle || isTriG || isNTriples || isN3);
    this._isImpliedBy = options.isImpliedBy;
    this._implicitEmptyPrefix = !!options.implicitEmptyPrefix;
    this._emptyFormulaAsTrue = !!options.emptyFormulaAsTrue;
    if (isLineMode)
      this._resolveRelativeIRI = (iri4) => {
        return null;
      };
    this._blankNodePrefix = typeof options.blankNodePrefix !== "string" ? "" : options.blankNodePrefix.replace(/^(?!_:)/, "_:");
    this._lexer = options.lexer || new N3Lexer({ lineMode: isLineMode, n3: isN3, isImpliedBy: this._isImpliedBy });
    this._explicitQuantifiers = !!options.explicitQuantifiers;
    this._parseUnsupportedVersions = !!options.parseUnsupportedVersions;
    this._version = options.version;
  }
  // ## Static class methods
  // ### `_resetBlankNodePrefix` restarts blank node prefix identification
  static _resetBlankNodePrefix() {
    blankNodePrefix = 0;
  }
  // ## Private methods
  // ### `_setBase` sets the base IRI to resolve relative IRIs
  _setBase(baseIRI) {
    if (!baseIRI) {
      this._base = "";
      this._basePath = "";
    } else {
      const fragmentPos = baseIRI.indexOf("#");
      if (fragmentPos >= 0)
        baseIRI = baseIRI.substr(0, fragmentPos);
      this._base = baseIRI;
      this._basePath = baseIRI.indexOf("/") < 0 ? baseIRI : baseIRI.replace(/[^\/?]*(?:\?.*)?$/, "");
      baseIRI = baseIRI.match(/^(?:([a-z][a-z0-9+.-]*:))?(?:\/\/[^\/]*)?/i);
      this._baseRoot = baseIRI[0];
      this._baseScheme = baseIRI[1];
    }
  }
  // ### `_saveContext` stores the current parsing context
  // when entering a new scope (list, blank node, formula)
  _saveContext(type, graph, subject, predicate, object) {
    if (!this._n3Mode) {
      this._contextStack.push({ type, subject, predicate, object, graph });
      return;
    }
    const context2 = {
      type,
      subject,
      predicate,
      object,
      graph,
      inverse: this._inversePredicate,
      expectOf: this._expectOf,
      blankPrefix: this._prefixes._,
      quantified: this._quantified,
      emptyFormula: this._emptyFormula
    };
    if (type === "formula") {
      context2.prefixes = this._prefixes;
      context2.base = [this._base, this._basePath, this._baseRoot, this._baseScheme];
      this._prefixes = Object.create(this._prefixes);
    }
    this._contextStack.push(context2);
    this._inversePredicate = false;
    this._expectOf = false;
    this._prefixes._ = this._graph ? `${this._graph.value}.` : ".";
    this._quantified = Object.create(this._quantified);
    if (type === "formula") {
      this._subject = null;
      this._emptyFormula = true;
    }
  }
  // ### `_restoreContext` restores the parent context
  // when leaving a scope (list, blank node, formula)
  _restoreContext(type, token) {
    const context2 = this._contextStack.pop();
    if (!context2 || context2.type !== type)
      return this._error(`Unexpected ${token.type}`, token);
    this._subject = context2.subject;
    this._predicate = context2.predicate;
    this._object = context2.object;
    this._graph = context2.graph;
    if (this._n3Mode) {
      this._inversePredicate = context2.inverse;
      this._expectOf = context2.expectOf;
      if (type === "formula") {
        this._prefixes = context2.prefixes;
        [this._base, this._basePath, this._baseRoot, this._baseScheme] = context2.base;
      } else
        this._prefixes._ = context2.blankPrefix;
      this._quantified = context2.quantified;
      this._emptyFormula = context2.emptyFormula;
    }
  }
  // ### `_readBeforeTopContext` is called once only at the start of parsing.
  _readBeforeTopContext(token) {
    if (this._version && !this._isValidVersion(this._version))
      return this._error(`Detected unsupported version as media type parameter: "${this._version}"`, token);
    return this._readInTopContext(token);
  }
  // ### `_readInTopContext` reads a token when in the top context
  _readInTopContext(token) {
    switch (token.type) {
      // If an EOF token arrives in the top context, signal that we're done
      case "eof":
        if (this._graph !== null)
          return this._error("Unclosed graph", token);
        delete this._prefixes._;
        return this._callback(null, null, this._prefixes);
      // It could be a prefix declaration
      case "PREFIX":
        this._sparqlStyle = true;
      case "@prefix":
        return this._readPrefix;
      // It could be a base declaration
      case "BASE":
        this._sparqlStyle = true;
      case "@base":
        return this._readBaseIRI;
      // It could be a version declaration
      case "VERSION":
        this._sparqlStyle = true;
      case "@version":
        return this._readVersion;
      // It could be a graph
      case "{":
        if (this._supportsNamedGraphs) {
          this._graph = "";
          this._subject = null;
          return this._readSubject;
        }
      case "GRAPH":
        if (this._supportsNamedGraphs)
          return this._readNamedGraphLabel;
      // Otherwise, the next token must be a subject
      default:
        return this._readSubject(token);
    }
  }
  // ### `_readInFormulaContext` reads a token at the statement level of a formula
  _readInFormulaContext(token) {
    switch (token.type) {
      case "PREFIX":
        this._sparqlStyle = true;
      case "@prefix":
        return this._readPrefix;
      case "BASE":
        this._sparqlStyle = true;
      case "@base":
        return this._readBaseIRI;
      default:
        return this._readSubject(token);
    }
  }
  // ### `_getStatementReader` returns the reader for the current statement scope
  _getStatementReader() {
    const context2 = this._contextStack[this._contextStack.length - 1];
    return context2 && context2.type === "formula" ? this._readInFormulaContext : this._readInTopContext;
  }
  // ### `_readEntity` reads an IRI, prefixed name, blank node, or variable
  _readEntity(token, quantifier) {
    let value;
    switch (token.type) {
      // Read a relative or absolute IRI
      case "IRI":
      case "typeIRI":
        const iri4 = this._resolveIRI(token.value);
        if (iri4 === null)
          return this._error("Invalid IRI", token);
        value = this._factory.namedNode(iri4);
        break;
      // Read a prefixed name
      case "type":
      case "prefixed":
        const prefix = this._prefixes[token.prefix];
        if (prefix === void 0)
          return this._error(`Undefined prefix "${token.prefix}:"`, token);
        value = this._factory.namedNode(prefix + token.value);
        break;
      // Read a blank node
      case "blank":
        value = this._factory.blankNode(this._prefixes[token.prefix] + token.value);
        break;
      // Read a variable
      case "var":
        value = this._factory.variable(token.value.substr(1));
        break;
      // Everything else is not an entity
      default:
        return this._error(`Expected entity but got ${token.type}`, token);
    }
    if (!quantifier && this._n3Mode && value.id in this._quantified)
      value = this._quantified[value.id];
    return value;
  }
  // ### `_readList` starts reading a list in the subject, predicate, or object position
  _readList(token, subject, predicate, object) {
    const stack = this._contextStack, parent = stack.length && stack[stack.length - 1];
    if (parent.type === "<<") {
      return this._error("Unexpected list in reified triple", token);
    }
    this._saveContext("list", this._graph, subject, predicate, object);
    this._subject = null;
    return this._readListItem;
  }
  // ### `_readSubject` reads a quad's subject
  _readSubject(token) {
    this._predicate = null;
    if (token.type !== "}")
      this._emptyFormula = false;
    switch (token.type) {
      case "[":
        this._saveContext(
          "blank",
          this._graph,
          this._subject = this._factory.blankNode(),
          null,
          null
        );
        return this._readBlankNodeHead;
      case "(":
        return this._readList(token, this.RDF_NIL, null, null);
      case "{":
        if (!this._n3Mode)
          return this._error("Unexpected graph", token);
        this._saveContext(
          "formula",
          this._graph,
          this._graph = this._factory.blankNode(),
          null,
          null
        );
        return this._readInFormulaContext;
      case "}":
        return this._readPunctuation(token);
      case "@forSome":
        if (!this._n3Mode)
          return this._error('Unexpected "@forSome"', token);
        this._subject = null;
        this._predicate = this.N3_FORSOME;
        this._quantifier = "blankNode";
        return this._readQuantifierList;
      case "@forAll":
        if (!this._n3Mode)
          return this._error('Unexpected "@forAll"', token);
        this._subject = null;
        this._predicate = this.N3_FORALL;
        this._quantifier = "variable";
        return this._readQuantifierList;
      case "literal":
        if (!this._n3Mode)
          return this._error("Unexpected literal", token);
        if (token.prefix.length === 0) {
          this._literalValue = token.value;
          return this._completeSubjectLiteral;
        } else {
          this._subject = this._factory.literal(token.value, this._factory.namedNode(token.prefix));
          return this._getPathReader(this._readPredicateOrNamedGraph);
        }
      case "<<(":
        if (!this._n3Mode)
          return this._error("Disallowed triple term as subject", token);
        this._saveContext("<<(", this._graph, null, null, null);
        this._graph = null;
        return this._readSubject;
      case "<<":
        this._saveContext("<<", this._graph, null, null, null);
        this._graph = null;
        return this._readSubject;
      default:
        if ((this._subject = this._readEntity(token)) === void 0)
          return;
        if (this._n3Mode)
          return this._getPathReader(this._readPredicateOrNamedGraph);
    }
    return this._readPredicateOrNamedGraph;
  }
  // ### `_readPredicate` reads a quad's predicate
  _readPredicate(token) {
    const type = token.type;
    let pathable = false;
    switch (type) {
      case "inverse":
        this._inversePredicate = true;
      case "abbreviation":
        this._predicate = this.ABBREVIATIONS[token.value];
        break;
      case "has":
        return this._readPredicateAfterVerb;
      case "is":
        this._inversePredicate = true;
        this._expectOf = true;
        return this._readPredicateAfterVerb;
      case "inversePredicate":
        this._inversePredicate = true;
        return this._readPredicateAfterVerb;
      case ".":
      case "]":
      case "}":
      case "|}":
        if (this._predicate === null && !this._n3Mode)
          return this._error(`Unexpected ${type}`, token);
        this._subject = null;
        return type === "]" ? this._readBlankNodeTail(token) : this._readPunctuation(token);
      case ";":
        return this._predicate !== null ? this._readPredicate : this._error("Expected predicate but got ;", token);
      case "literal":
        if (!this._n3Mode)
          return this._error("Unexpected literal", token);
        if (token.prefix.length === 0) {
          this._literalValue = token.value;
          return this._completePredicateLiteral;
        } else
          this._predicate = this._factory.literal(token.value, this._factory.namedNode(token.prefix));
        pathable = true;
        break;
      case "(":
        return this._n3Mode ? this._readList(token, this._subject, this.RDF_NIL, null) : this._error(`Expected entity but got ${type}`, token);
      case "[":
        if (this._n3Mode) {
          this._saveContext(
            "blank",
            this._graph,
            this._subject,
            this._subject = this._factory.blankNode(),
            null
          );
          return this._readBlankNodeHead;
        }
        return this._error("Disallowed blank node as predicate", token);
      case "{":
        if (this._n3Mode) {
          this._saveContext(
            "formula",
            this._graph,
            this._subject,
            this._graph = this._factory.blankNode(),
            null
          );
          return this._readSubject;
        }
        return this._readEntity(token);
      case "blank":
        if (!this._n3Mode)
          return this._error("Disallowed blank node as predicate", token);
      default:
        if ((this._predicate = this._readEntity(token)) === void 0)
          return;
        pathable = this._n3Mode;
    }
    this._validAnnotation = true;
    return pathable ? this._getPathReader(this._readObject, "predicate") : this._readObject;
  }
  // ### `_readPredicateAfterVerb` reads the predicate following `has` or `is`
  _readPredicateAfterVerb(token) {
    if (token.type === "has" || token.type === "is" || token.type === "of" || token.type === "inversePredicate")
      return this._error(`Expected expression but got ${token.type}`, token);
    return this._readPredicate(token);
  }
  // ### `_readObject` reads a quad's object
  _readObject(token) {
    if (this._expectOf) {
      if (token.type !== "of")
        return this._error(`Expected of but got ${token.type}`, token);
      this._expectOf = false;
      return this._readObject;
    }
    switch (token.type) {
      case "literal":
        if (token.prefix.length === 0) {
          this._literalValue = token.value;
          return this._readDataTypeOrLang;
        } else {
          this._object = this._factory.literal(token.value, this._factory.namedNode(token.prefix));
          if (this._n3Mode)
            return this._getPathReader(this._getContextEndReader());
        }
        break;
      case "[":
        this._saveContext(
          "blank",
          this._graph,
          this._subject,
          this._predicate,
          this._subject = this._factory.blankNode()
        );
        return this._readBlankNodeHead;
      case "(":
        return this._readList(token, this._subject, this._predicate, this.RDF_NIL);
      case "{":
        if (!this._n3Mode)
          return this._error("Unexpected graph", token);
        this._saveContext(
          "formula",
          this._graph,
          this._subject,
          this._predicate,
          this._graph = this._factory.blankNode()
        );
        return this._readInFormulaContext;
      case "<<(":
        this._saveContext("<<(", this._graph, this._subject, this._predicate, null);
        this._graph = null;
        return this._readSubject;
      case "<<":
        this._saveContext("<<", this._graph, this._subject, this._predicate, null);
        this._graph = null;
        return this._readSubject;
      default:
        if ((this._object = this._readEntity(token)) === void 0)
          return;
        if (this._n3Mode)
          return this._getPathReader(this._getContextEndReader());
    }
    return this._getContextEndReader();
  }
  // ### `_readPredicateOrNamedGraph` reads a quad's predicate, or a named graph
  _readPredicateOrNamedGraph(token) {
    return token.type === "{" ? this._readGraph(token) : this._readPredicate(token);
  }
  // ### `_readGraph` reads a graph
  _readGraph(token) {
    if (token.type !== "{")
      return this._error(`Expected graph but got ${token.type}`, token);
    this._graph = this._subject, this._subject = null;
    return this._readSubject;
  }
  // ### `_readBlankNodeHead` reads the head of a blank node
  _readBlankNodeHead(token) {
    if (token.type === "]") {
      this._subject = null;
      return this._readBlankNodeTail(token);
    } else {
      const stack = this._contextStack, parentParent = stack.length > 1 && stack[stack.length - 2];
      if (parentParent.type === "<<") {
        return this._error("Unexpected compound blank node expression in reified triple", token);
      }
      if (token.type === "id")
        return this._readIriPropertyListId;
      this._predicate = null;
      return this._readPredicate(token);
    }
  }
  // ### `_readIriPropertyListId` replaces a property list's blank node with its IRI
  _readIriPropertyListId(token) {
    const iri4 = this._readEntity(token);
    if (iri4 === void 0)
      return;
    if (iri4.termType !== "NamedNode")
      return this._error(`Expected IRI after id but got ${token.type}`, token);
    const placeholder = this._subject;
    this._subject = iri4;
    const context2 = this._contextStack[this._contextStack.length - 1];
    if (context2.subject === placeholder)
      context2.subject = iri4;
    if (context2.predicate === placeholder)
      context2.predicate = iri4;
    if (context2.object === placeholder)
      context2.object = iri4;
    this._predicate = null;
    return this._readIriPropertyListPredicate;
  }
  // ### `_readIriPropertyListPredicate` requires properties after an IRI property list ID
  _readIriPropertyListPredicate(token) {
    if (token.type === ";" || token.type === "]" || token.type === "." || token.type === "}")
      return this._error(`Expected predicate but got ${token.type}`, token);
    return this._readPredicate(token);
  }
  // ### `_readBlankNodeTail` reads the end of a blank node
  _readBlankNodeTail(token) {
    if (token.type !== "]")
      return this._readBlankNodePunctuation(token);
    if (this._subject !== null)
      this._emitCurrent(this._subject, this._predicate, this._object, this._graph);
    const empty = this._predicate === null;
    this._restoreContext("blank", token);
    if (this._object !== null)
      return this._getContextEndReader();
    else if (this._predicate !== null)
      return this._getPathReader(this._readObject, "predicate");
    else
      return empty ? this._readPredicateOrNamedGraph : this._readPredicateAfterBlank;
  }
  // ### `_readPredicateAfterBlank` reads a predicate after an anonymous blank node
  _readPredicateAfterBlank(token) {
    switch (token.type) {
      case ".":
      case "}":
        this._subject = null;
        return this._readPunctuation(token);
      default:
        return this._readPredicate(token);
    }
  }
  // ### `_readListItem` reads items from a list
  _readListItem(token) {
    let item = null, list = null, next = this._readListItem;
    const previousList = this._subject, stack = this._contextStack, parent = stack[stack.length - 1];
    switch (token.type) {
      case "[":
        this._saveContext(
          "blank",
          this._graph,
          list = this._factory.blankNode(),
          this.RDF_FIRST,
          this._subject = item = this._factory.blankNode()
        );
        next = this._readBlankNodeHead;
        break;
      case "(":
        this._saveContext(
          "list",
          this._graph,
          list = this._factory.blankNode(),
          this.RDF_FIRST,
          this.RDF_NIL
        );
        this._subject = null;
        break;
      case ")":
        this._restoreContext("list", token);
        if (stack.length !== 0 && stack[stack.length - 1].type === "list") {
          if (this._n3Mode) {
            if (previousList !== null)
              this._emit(previousList, this.RDF_REST, this.RDF_NIL, this._graph);
            this._saveContext("item", this._graph, this._subject, this._predicate, this._object);
            this._subject = this._object, this._predicate = null;
            return this._getPathReader(this._readListItem);
          }
          this._emit(this._subject, this._predicate, this._object, this._graph);
        }
        if (this._predicate === null) {
          next = this._n3Mode ? this._getPathReader(this._readPredicate) : this._readPredicate;
          if (this._subject === this.RDF_NIL)
            return next;
        } else if (this._object === null) {
          next = this._getPathReader(this._readObject, "predicate");
          if (this._predicate === this.RDF_NIL)
            return next;
        } else {
          next = this._getContextEndReader();
          if (this._n3Mode)
            next = this._getPathReader(next);
          if (this._object === this.RDF_NIL)
            return next;
        }
        list = this.RDF_NIL;
        break;
      case "literal":
        if (token.prefix.length === 0) {
          this._literalValue = token.value;
          next = this._readListItemDataTypeOrLang;
        } else {
          item = this._factory.literal(token.value, this._factory.namedNode(token.prefix));
          next = this._getContextEndReader();
        }
        break;
      case "{":
        if (!this._n3Mode)
          return this._error("Unexpected graph", token);
        list = this._factory.blankNode();
        item = this._factory.blankNode();
        if (previousList === null) {
          if (parent.predicate === null)
            parent.subject = list;
          else
            parent.object = list;
        } else {
          this._emit(previousList, this.RDF_REST, list, this._graph);
        }
        this._emit(list, this.RDF_FIRST, item, this._graph);
        this._saveContext(
          "formula",
          this._graph,
          list,
          this.RDF_FIRST,
          this._graph = item
        );
        this._subject = null;
        return this._readInFormulaContext;
      case "<<(":
        this._saveContext("<<(", this._graph, null, null, null);
        this._graph = null;
        next = this._readSubject;
        break;
      case "<<":
        this._saveContext("<<", this._graph, null, null, null);
        this._graph = null;
        next = this._readSubject;
        break;
      default:
        if ((item = this._readEntity(token)) === void 0)
          return;
    }
    if (list === null)
      this._subject = list = this._factory.blankNode();
    if (token.type === "<<" || token.type === "<<(")
      stack[stack.length - 1].subject = this._subject;
    if (previousList === null) {
      if (parent.predicate === null)
        parent.subject = list;
      else if (parent.object === null)
        parent.predicate = list;
      else
        parent.object = list;
    } else {
      this._emit(previousList, this.RDF_REST, list, this._graph);
    }
    if (item !== null) {
      if (this._n3Mode && (token.type === "IRI" || token.type === "prefixed" || token.type === "var" || token.type === "blank" || token.type === "literal")) {
        this._saveContext("item", this._graph, list, this.RDF_FIRST, item);
        this._subject = item, this._predicate = null;
        return this._getPathReader(this._readListItem);
      }
      this._emit(list, this.RDF_FIRST, item, this._graph);
    }
    return next;
  }
  // ### `_readDataTypeOrLang` reads an _optional_ datatype or language
  _readDataTypeOrLang(token) {
    return this._completeObjectLiteral(token, false);
  }
  // ### `_readListItemDataTypeOrLang` reads an _optional_ datatype or language in a list
  _readListItemDataTypeOrLang(token) {
    return this._completeObjectLiteral(token, true);
  }
  // ### `_completeLiteral` completes a literal with an optional datatype or language
  // Defers possible direction tags without allocating bound callbacks.
  _completeLiteral(token, component) {
    let literal4, readCb = false;
    switch (token.type) {
      // Create a datatyped literal
      case "type":
      case "typeIRI":
        const datatype = this._readEntity(token);
        if (datatype === void 0) return;
        if (datatype.value === IRIs_default.rdf.langString || datatype.value === IRIs_default.rdf.dirLangString) {
          return this._error("Detected illegal (directional) languaged-tagged string with explicit datatype", token);
        }
        literal4 = this._factory.literal(this._literalValue, datatype);
        token = null;
        break;
      // Create a language-tagged string
      case "langcode":
        if (token.value.split("-").some((t) => t.length > 8))
          return this._error("Detected language tag with subtag longer than 8 characters", token);
        literal4 = this._factory.literal(this._literalValue, token.value);
        this._literalLanguage = token.value;
        token = null;
        this._literalComponent = component;
        readCb = true;
        break;
      // Create a simple string literal by default
      default:
        literal4 = this._factory.literal(this._literalValue);
    }
    return { token, literal: literal4, readCb };
  }
  // ### `_readDirCode` reads an optional directional language tag
  _readDirCode(token) {
    const component = this._literalComponent, listItem = this._literalListItem;
    if (token.type === "dircode") {
      const term2 = this._factory.literal(this._literalValue, { language: this._literalLanguage, direction: token.value });
      if (component === "subject")
        this._subject = term2;
      else if (component === "predicate")
        this._predicate = term2;
      else
        this._object = term2;
      this._literalLanguage = void 0;
      token = null;
    }
    if (component === "subject" || component === "predicate") {
      const next = component === "subject" ? this._readPredicateOrNamedGraph : this._readObject;
      const reader = this._getPathEndReader(token, next, component);
      return reader || next.call(this, token);
    }
    return this._completeObjectLiteralPost(token, listItem);
  }
  // Completes a literal in subject or predicate position
  _completeTermLiteral(token, component) {
    const completed = this._completeLiteral(token, component);
    if (!completed)
      return;
    let next;
    if (component === "subject") {
      this._subject = completed.literal;
      next = this._readPredicateOrNamedGraph;
    } else {
      this._predicate = completed.literal;
      this._validAnnotation = true;
      next = this._readObject;
    }
    if (completed.readCb) {
      this._literalListItem = false;
      return this._readDirCode;
    }
    const reader = this._getPathEndReader(completed.token, next, component);
    if (reader)
      return reader;
    return next.call(this, completed.token);
  }
  // Completes a literal in subject position
  _completeSubjectLiteral(token) {
    return this._completeTermLiteral(token, "subject");
  }
  // Completes a literal in predicate position
  _completePredicateLiteral(token) {
    return this._completeTermLiteral(token, "predicate");
  }
  // Completes a literal in object position
  _completeObjectLiteral(token, listItem) {
    const completed = this._completeLiteral(token, "object");
    if (!completed)
      return;
    this._object = completed.literal;
    if (completed.readCb) {
      this._literalListItem = listItem;
      return this._readDirCode;
    }
    return this._completeObjectLiteralPost(completed.token, listItem);
  }
  _completeObjectLiteralPost(token, listItem) {
    if (this._n3Mode && (token === null || token.type === "!" || token.type === "^")) {
      if (listItem) {
        this._saveContext("item", this._graph, this._subject, this.RDF_FIRST, this._object);
        this._subject = this._object, this._predicate = null;
        return this._getPathEndReader(token, this._readListItem);
      }
      return this._getPathEndReader(token, this._getContextEndReader());
    }
    if (listItem)
      this._emit(this._subject, this.RDF_FIRST, this._object, this._graph);
    if (token === null)
      return this._getContextEndReader();
    else {
      this._readCallback = this._getContextEndReader();
      return this._readCallback(token);
    }
  }
  // ### `_readFormulaTail` reads the end of a formula
  _readFormulaTail(token) {
    if (token.type !== "}")
      return this._readPunctuation(token);
    if (this._subject !== null)
      this._emitCurrent(this._subject, this._predicate, this._object, this._graph);
    const formula = this._graph, empty = this._emptyFormula;
    this._restoreContext("formula", token);
    if (empty && this._emptyFormulaAsTrue) {
      if (this._subject === formula)
        this._subject = this.N3_TRUE;
      else if (this._predicate === formula)
        this._predicate = this.N3_TRUE;
      else
        this._object = this.N3_TRUE;
    }
    if (this._object !== null)
      return this._getPathReader(this._getContextEndReader(), "object");
    if (this._predicate !== null)
      return this._getPathReader(this._readObject, "predicate");
    return this._getPathReader(this._readPredicate, "subject");
  }
  // ### `_readPunctuation` reads punctuation between quads or quad parts
  _readPunctuation(token) {
    let next, graph = this._graph, startingAnnotation = false;
    const subject = this._subject, inversePredicate = this._inversePredicate;
    switch (token.type) {
      // A closing brace ends a graph
      case "}":
        if (this._graph === null)
          return this._error("Unexpected graph closing", token);
        if (this._n3Mode)
          return this._readFormulaTail(token);
        this._graph = null;
      // A dot just ends the statement, without sharing anything with the next
      case ".":
        this._subject = null;
        this._tripleTerm = null;
        next = this._getStatementReader();
        if (inversePredicate) this._inversePredicate = false;
        break;
      // Semicolon means the subject is shared; predicate and object are different
      case ";":
        if (inversePredicate) this._inversePredicate = false;
        next = this._readPredicate;
        break;
      // Comma means both the subject and predicate are shared; the object is different
      case ",":
        next = this._readObject;
        break;
      // ~ is allowed in the annotation syntax
      case "~":
        if (subject !== null)
          this._tripleTerm = null;
        next = this._readReifierInAnnotation;
        startingAnnotation = true;
        break;
      // {| means that the current triple is annotated with predicate-object pairs.
      case "{|":
        if (subject !== null)
          this._tripleTerm = null;
        this._subject = this._readTripleTerm();
        this._inversePredicate = false;
        this._validAnnotation = false;
        startingAnnotation = true;
        next = this._readPredicate;
        break;
      // |} means that the current reified triple in annotation syntax is finalized.
      case "|}":
        if (!this._annotation)
          return this._error("Unexpected annotation syntax closing", token);
        if (!this._validAnnotation)
          return this._error("Annotation block can not be empty", token);
        this._subject = null;
        this._annotation = false;
        this._inversePredicate = false;
        next = this._getContextEndReader();
        break;
      default:
        if (this._supportsQuads && this._graph === null && (graph = this._readEntity(token)) !== void 0) {
          next = this._readQuadPunctuation;
          break;
        }
        return this._error(`Expected punctuation to follow "${this._object.id}"`, token);
    }
    if (subject !== null && (!startingAnnotation || startingAnnotation && !this._annotation)) {
      const predicate = this._predicate, object = this._object;
      this._emit(subject, predicate, object, graph, inversePredicate);
    }
    if (startingAnnotation) {
      this._annotation = true;
    }
    return next;
  }
  // ### `_readBlankNodePunctuation` reads punctuation in a blank node
  _readBlankNodePunctuation(token) {
    let next, resetInversePredicate = false;
    switch (token.type) {
      // Semicolon means the subject is shared; predicate and object are different
      case ";":
        resetInversePredicate = this._inversePredicate;
        next = this._readPredicate;
        break;
      // Comma means both the subject and predicate are shared; the object is different
      case ",":
        next = this._readObject;
        break;
      // Annotation syntax applies to the quad just read, exactly as it does
      // outside of a blank node property list.  `|}` arrives here too, because
      // the objects inside the annotation block are themselves read within the
      // enclosing blank node context.
      case "~":
      case "{|":
      case "|}":
        return this._readPunctuation(token);
      default:
        return this._error(`Expected punctuation to follow "${this._object.id}"`, token);
    }
    if (this._subject === null)
      return this._error("Expected ] to follow annotation", token);
    this._emitCurrent(this._subject, this._predicate, this._object, this._graph);
    if (resetInversePredicate)
      this._inversePredicate = false;
    return next;
  }
  // ### `_readQuadPunctuation` reads punctuation after a quad
  _readQuadPunctuation(token) {
    if (token.type !== ".")
      return this._error("Expected dot to follow quad", token);
    return this._readInTopContext;
  }
  // ### `_readPrefix` reads the prefix of a prefix declaration
  _readPrefix(token) {
    if (token.type !== "prefix")
      return this._error("Expected prefix to follow @prefix", token);
    this._prefix = token.value;
    return this._readPrefixIRI;
  }
  // ### `_readPrefixIRI` reads the IRI of a prefix declaration
  _readPrefixIRI(token) {
    if (token.type !== "IRI")
      return this._error(`Expected IRI to follow prefix "${this._prefix}:"`, token);
    const prefixNode = this._readEntity(token);
    this._prefixes[this._prefix] = prefixNode.value;
    this._prefixCallback(this._prefix, prefixNode);
    return this._readDeclarationPunctuation;
  }
  // ### `_readBaseIRI` reads the IRI of a base declaration
  _readBaseIRI(token) {
    const iri4 = token.type === "IRI" && this._resolveIRI(token.value);
    if (!iri4)
      return this._error("Expected valid IRI to follow base declaration", token);
    this._setBase(iri4);
    return this._readDeclarationPunctuation;
  }
  // ### `_isValidVersion` checks if the given version is valid for this parser to handle.
  _isValidVersion(version) {
    return this._parseUnsupportedVersions || _N3Parser.SUPPORTED_VERSIONS.includes(version);
  }
  // ### `_readVersion` reads version string declaration
  _readVersion(token) {
    if (token.type !== "literal")
      return this._error("Expected literal to follow version declaration", token);
    if (token.end - token.start !== token.value.length + 2)
      return this._error("Version declarations must use single quotes", token);
    this._versionCallback(token.value);
    if (!this._isValidVersion(token.value))
      return this._error(`Detected unsupported version: "${token.value}"`, token);
    return this._readDeclarationPunctuation;
  }
  // ### `_readNamedGraphLabel` reads the label of a named graph
  _readNamedGraphLabel(token) {
    switch (token.type) {
      case "IRI":
      case "blank":
      case "prefixed":
        return this._readSubject(token), this._readGraph;
      case "[":
        return this._readNamedGraphBlankLabel;
      default:
        return this._error("Invalid graph label", token);
    }
  }
  // ### `_readNamedGraphLabel` reads a blank node label of a named graph
  _readNamedGraphBlankLabel(token) {
    if (token.type !== "]")
      return this._error("Invalid graph label", token);
    this._subject = this._factory.blankNode();
    return this._readGraph;
  }
  // ### `_readDeclarationPunctuation` reads the punctuation of a declaration
  _readDeclarationPunctuation(token) {
    if (this._sparqlStyle) {
      this._sparqlStyle = false;
      return this._getStatementReader().call(this, token);
    }
    if (token.type !== ".")
      return this._error("Expected declaration to end with a dot", token);
    return this._getStatementReader();
  }
  // Reads a list of quantified symbols from a @forSome or @forAll statement
  _readQuantifierList(token) {
    let entity;
    switch (token.type) {
      case "IRI":
      case "prefixed":
        if ((entity = this._readEntity(token, true)) !== void 0)
          break;
      default:
        return this._error(`Unexpected ${token.type}`, token);
    }
    if (!this._explicitQuantifiers)
      this._quantified[entity.id] = this._factory[this._quantifier](this._factory.blankNode().value);
    else {
      if (this._subject === null)
        this._emit(
          this._graph || this.DEFAULTGRAPH,
          this._predicate,
          this._subject = this._factory.blankNode(),
          this.QUANTIFIERS_GRAPH
        );
      else
        this._emit(
          this._subject,
          this.RDF_REST,
          this._subject = this._factory.blankNode(),
          this.QUANTIFIERS_GRAPH
        );
      this._emit(this._subject, this.RDF_FIRST, entity, this.QUANTIFIERS_GRAPH);
    }
    return this._readQuantifierPunctuation;
  }
  // Reads punctuation from a @forSome or @forAll statement
  _readQuantifierPunctuation(token) {
    if (token.type === ",")
      return this._readQuantifierList;
    else {
      if (this._explicitQuantifiers) {
        this._emit(this._subject, this.RDF_REST, this.RDF_NIL, this.QUANTIFIERS_GRAPH);
        this._subject = null;
      }
      this._readCallback = this._getContextEndReader();
      return this._readCallback(token);
    }
  }
  // ### `_getPathReader` reads a potential path and then resumes with the given function
  _getPathReader(afterPath, position) {
    this._afterPath = afterPath;
    this._pathPosition = position || (this._predicate === null ? "subject" : "object");
    return this._readPath;
  }
  // ### `_getPathEndReader` continues reading after a term that might start a path,
  // given the pending token that follows the term (or `null` if it was consumed)
  _getPathEndReader(token, afterPath, position) {
    if (token !== null && token.type !== "!" && token.type !== "^")
      return null;
    const reader = this._getPathReader(afterPath, position);
    return token === null ? reader : reader.call(this, token);
  }
  // ### `_readPath` reads a potential path
  _readPath(token) {
    switch (token.type) {
      // Forward path
      case "!":
        return this._readForwardPath;
      // Backward path
      case "^":
        return this._readBackwardPath;
      // Not a path; resume reading where we left off
      default:
        const afterPath = this._afterPath;
        const stack = this._contextStack, parent = stack.length && stack[stack.length - 1];
        if (parent && parent.type === "item") {
          const item = this._subject;
          this._restoreContext("item", token);
          this._emit(this._subject, this.RDF_FIRST, item, this._graph);
        }
        this._afterPath = null;
        this._pathPosition = null;
        return afterPath.call(this, token);
    }
  }
  // ### `_readForwardPath` reads a '!' path
  _readForwardPath(token) {
    let subject, predicate;
    const object = this._factory.blankNode();
    if ((predicate = this._readEntity(token)) === void 0)
      return;
    if (this._pathPosition === "subject")
      subject = this._subject, this._subject = object;
    else if (this._pathPosition === "predicate")
      subject = this._predicate, this._predicate = object;
    else
      subject = this._object, this._object = object;
    this._emit(subject, predicate, object, this._graph);
    return this._readPath;
  }
  // ### `_readBackwardPath` reads a '^' path
  _readBackwardPath(token) {
    const subject = this._factory.blankNode();
    let predicate, object;
    if ((predicate = this._readEntity(token)) === void 0)
      return;
    if (this._pathPosition === "subject")
      object = this._subject, this._subject = subject;
    else if (this._pathPosition === "predicate")
      object = this._predicate, this._predicate = subject;
    else
      object = this._object, this._object = subject;
    this._emit(subject, predicate, object, this._graph);
    return this._readPath;
  }
  // ### `_readTripleTermTail` reads the end of a triple term
  _readTripleTermTail(token) {
    if (token.type !== ")>>")
      return this._error(`Expected )>> but got ${token.type}`, token);
    const quad3 = this._createQuad(
      this._subject,
      this._predicate,
      this._object,
      this._graph,
      this._inversePredicate
    );
    this._restoreContext("<<(", token);
    const stack = this._contextStack, parent = stack.length && stack[stack.length - 1];
    if (parent && parent.type === "list") {
      this._emit(this._subject, this.RDF_FIRST, quad3, this._graph);
      return this._getContextEndReader();
    }
    if (this._subject === null) {
      this._subject = quad3;
      return this._readPredicate;
    } else {
      this._object = quad3;
      return this._getContextEndReader();
    }
  }
  // ### `_readReifiedTripleTailOrReifier` reads a reifier or the end of a nested reified triple
  _readReifiedTripleTailOrReifier(token) {
    if (token.type === "~") {
      return this._readReifier;
    }
    return this._readReifiedTripleTail(token);
  }
  // ### `_readReifiedTripleTail` reads the end of a nested reified triple
  _readReifiedTripleTail(token) {
    if (token.type !== ">>")
      return this._error(`Expected >> but got ${token.type}`, token);
    this._tripleTerm = null;
    const reifier = this._readTripleTerm();
    this._restoreContext("<<", token);
    const stack = this._contextStack, parent = stack.length && stack[stack.length - 1];
    if (parent && parent.type === "list") {
      this._emit(this._subject, this.RDF_FIRST, reifier, this._graph);
      return this._getContextEndReader();
    } else if (this._subject === null) {
      this._subject = reifier;
      return this._readPredicateOrReifierTripleEnd;
    } else {
      this._object = reifier;
      return this._getContextEndReader();
    }
  }
  _readPredicateOrReifierTripleEnd(token) {
    if (token.type === ".") {
      this._subject = null;
      return this._readPunctuation(token);
    }
    return this._readPredicate(token);
  }
  // ### `_readReifier` reads the triple term identifier after a tilde when in a reifying triple.
  _readReifier(token) {
    this._reifier = this._readEntity(token);
    return this._readReifiedTripleTail;
  }
  // ### `_readReifier` reads the optional triple term identifier after a tilde when in annotation syntax.
  _readReifierInAnnotation(token) {
    if (token.type === "IRI" || token.type === "typeIRI" || token.type === "type" || token.type === "prefixed" || token.type === "blank" || token.type === "var") {
      this._reifier = this._readEntity(token);
      return this._readAnnotationBlockOrPunctuation;
    }
    this._readTripleTerm();
    this._subject = null;
    return this._getContextEndReader().call(this, token);
  }
  // ### `_readAnnotationBlockOrPunctuation` reads what follows an explicit reifier:
  // either an annotation block, which reuses the reifier as its subject,
  // or punctuation, in which case the reifier stands alone and its triple
  // term still needs to be asserted here.
  _readAnnotationBlockOrPunctuation(token) {
    if (token.type === "{|")
      return this._readPunctuation(token);
    this._readTripleTerm();
    this._annotation = false;
    this._tripleTerm = null;
    switch (token.type) {
      // The subject stays shared with the next predicate-object pair
      case ";":
        this._inversePredicate = false;
        return this._readPredicate;
      // The subject and predicate stay shared with the next object
      case ",":
        return this._readObject;
      default:
        this._subject = null;
        return this._getContextEndReader().call(this, token);
    }
  }
  _readTripleTerm() {
    const stack = this._contextStack, parent = stack.length && stack[stack.length - 1];
    const parentGraph = parent ? parent.graph : void 0;
    const reifier = this._reifier || this._factory.blankNode();
    this._reifier = null;
    this._tripleTerm = this._tripleTerm || this._createQuad(
      this._subject,
      this._predicate,
      this._object,
      null,
      this._inversePredicate
    );
    this._emit(reifier, this.RDF_REIFIES, this._tripleTerm, parentGraph || this._graph || this.DEFAULTGRAPH);
    return reifier;
  }
  // ### `_getContextEndReader` gets the next reader function at the end of a context
  _getContextEndReader() {
    const contextStack = this._contextStack;
    if (!contextStack.length)
      return this._readPunctuation;
    switch (contextStack[contextStack.length - 1].type) {
      case "blank":
        return this._readBlankNodeTail;
      case "list":
        return this._readListItem;
      case "formula":
        return this._readFormulaTail;
      case "<<(":
        return this._readTripleTermTail;
      case "<<":
        return this._readReifiedTripleTailOrReifier;
    }
  }
  // ### `_createQuad` creates a quad
  _createQuad(subject, predicate, object, graph) {
    return this._factory.quad(subject, predicate, object, graph || this.DEFAULTGRAPH);
  }
  // ### `_createQuadInDirection` creates a quad in the active predicate direction
  _createQuadInDirection(subject, predicate, object, graph, inversePredicate) {
    return inversePredicate ? this._factory.quad(object, predicate, subject, graph || this.DEFAULTGRAPH) : this._factory.quad(subject, predicate, object, graph || this.DEFAULTGRAPH);
  }
  // ### `_emitInDirection` sends a quad in the active predicate direction
  _emitInDirection(subject, predicate, object, graph, inversePredicate) {
    this._callback(null, this._createQuad(subject, predicate, object, graph, inversePredicate));
  }
  // ### `_emitCurrentInDirection` sends a quad in the current predicate direction
  _emitCurrentInDirection(subject, predicate, object, graph) {
    this._callback(null, this._createQuad(subject, predicate, object, graph, this._inversePredicate));
  }
  // ### `_emit` sends a quad through the callback
  _emit(subject, predicate, object, graph) {
    this._callback(null, this._factory.quad(subject, predicate, object, graph || this.DEFAULTGRAPH));
  }
  // ### `_error` emits an error message through the callback
  _error(message, token) {
    const suffix = ` on line ${token.line}.`;
    if (message.length + suffix.length > 200)
      message = `${message.slice(0, 199 - suffix.length)}\u2026`;
    const err = new Error(`${message}${suffix}`);
    err.context = {
      token,
      line: token.line,
      previousToken: this._lexer.previousToken
    };
    this._callback(err);
    this._callback = noop;
  }
  // ### `_resolveIRI` resolves an IRI against the base path
  _resolveIRI(iri4) {
    return /^[a-z][a-z0-9+.-]*:/i.test(iri4) ? iri4 : this._resolveRelativeIRI(iri4);
  }
  // ### `_resolveRelativeIRI` resolves an IRI against the base path,
  // assuming that a base path has been set and that the IRI is indeed relative
  _resolveRelativeIRI(iri4) {
    if (!iri4.length)
      return this._base;
    switch (iri4[0]) {
      // Resolve relative fragment IRIs against the base IRI
      case "#":
        return this._base + iri4;
      // Resolve relative query string IRIs by replacing the query string
      case "?":
        return this._base.replace(/(?:\?.*)?$/, iri4);
      // Resolve root-relative IRIs at the root of the base IRI
      case "/":
        return (iri4[1] === "/" ? this._baseScheme : this._baseRoot) + this._removeDotSegments(iri4);
      // Resolve all other IRIs at the base IRI's path
      default:
        return /^[^/:]*:/.test(iri4) ? null : this._removeDotSegments(this._basePath + iri4);
    }
  }
  // ### `_removeDotSegments` resolves './' and '../' path segments in an IRI as per RFC3986
  _removeDotSegments(iri4) {
    if (!/(^|\/)\.\.?($|[/#?])/.test(iri4))
      return iri4;
    const length = iri4.length;
    let result = "", i2 = -1, pathStart = -1, segmentStart = 0, next = "/";
    while (i2 < length) {
      switch (next) {
        // The path starts with the first slash after the authority
        case ":":
          if (pathStart < 0) {
            if (iri4[++i2] === "/" && iri4[++i2] === "/")
              while ((pathStart = i2 + 1) < length && iri4[pathStart] !== "/")
                i2 = pathStart;
          }
          break;
        // Don't modify a query string or fragment
        case "?":
        case "#":
          i2 = length;
          break;
        // Handle '/.' or '/..' path segments
        case "/":
          if (iri4[i2 + 1] === ".") {
            next = iri4[++i2 + 1];
            switch (next) {
              // Remove a '/.' segment
              case "/":
                result += iri4.substring(segmentStart, i2 - 1);
                segmentStart = i2 + 1;
                break;
              // Remove a trailing '/.' segment
              case void 0:
              case "?":
              case "#":
                return result + iri4.substring(segmentStart, i2) + iri4.substr(i2 + 1);
              // Remove a '/..' segment
              case ".":
                next = iri4[++i2 + 1];
                if (next === void 0 || next === "/" || next === "?" || next === "#") {
                  result += iri4.substring(segmentStart, i2 - 2);
                  if ((segmentStart = result.lastIndexOf("/")) >= pathStart)
                    result = result.substr(0, segmentStart);
                  if (next !== "/")
                    return `${result}/${iri4.substr(i2 + 1)}`;
                  segmentStart = i2 + 1;
                }
            }
          }
      }
      next = iri4[++i2];
    }
    return result + iri4.substring(segmentStart);
  }
  // ## Public methods
  // ### `parse` parses the N3 input and emits each parsed quad through the onQuad callback.
  parse(input, quadCallback, prefixCallback, versionCallback) {
    let onQuad, onPrefix, onComment, onVersion;
    if (quadCallback && (quadCallback.onQuad || quadCallback.onPrefix || quadCallback.onComment || quadCallback.onVersion)) {
      onQuad = quadCallback.onQuad;
      onPrefix = quadCallback.onPrefix;
      onComment = quadCallback.onComment;
      onVersion = quadCallback.onVersion;
    } else {
      onQuad = quadCallback;
      onPrefix = prefixCallback;
      onVersion = versionCallback;
    }
    this._readCallback = this._readBeforeTopContext;
    this._sparqlStyle = false;
    this._prefixes = /* @__PURE__ */ Object.create(null);
    this._prefixes._ = this._blankNodePrefix ? this._blankNodePrefix.substr(2) : `b${blankNodePrefix++}_`;
    if (this._n3Mode && this._implicitEmptyPrefix && this._base)
      this._prefixes[""] = this._resolveIRI("#");
    this._prefixCallback = onPrefix || noop;
    this._versionCallback = onVersion || noop;
    this._inversePredicate = false;
    this._expectOf = false;
    this._quantified = /* @__PURE__ */ Object.create(null);
    this._emptyFormula = false;
    if (!onQuad) {
      const quads = [];
      let error2;
      this._callback = (e, t) => {
        e ? error2 = e : t && quads.push(t);
      };
      this._lexer.tokenize(input).every((token) => {
        return this._readCallback = this._readCallback(token);
      });
      if (error2) throw error2;
      return quads;
    }
    let processNextToken = (error2, token) => {
      if (error2 !== null)
        this._callback(error2), this._callback = noop;
      else if (this._readCallback)
        this._readCallback = this._readCallback(token);
    };
    if (onComment) {
      this._lexer.comments = true;
      processNextToken = (error2, token) => {
        if (error2 !== null)
          this._callback(error2), this._callback = noop;
        else if (this._readCallback) {
          if (token.type === "comment")
            onComment(token.value);
          else
            this._readCallback = this._readCallback(token);
        }
      };
    }
    this._callback = onQuad;
    this._lexer.tokenize(input, processNextToken);
  }
};
function noop() {
}
function initDataFactory(parser, factory3) {
  parser._factory = factory3;
  parser.DEFAULTGRAPH = factory3.defaultGraph();
  parser.RDF_FIRST = factory3.namedNode(IRIs_default.rdf.first);
  parser.RDF_REST = factory3.namedNode(IRIs_default.rdf.rest);
  parser.RDF_NIL = factory3.namedNode(IRIs_default.rdf.nil);
  parser.RDF_REIFIES = factory3.namedNode(IRIs_default.rdf.reifies);
  parser.N3_FORALL = factory3.namedNode(IRIs_default.r.forAll);
  parser.N3_FORSOME = factory3.namedNode(IRIs_default.r.forSome);
  parser.N3_TRUE = factory3.literal("true", factory3.namedNode(IRIs_default.xsd.boolean));
  parser.ABBREVIATIONS = {
    "a": factory3.namedNode(IRIs_default.rdf.type),
    "=": factory3.namedNode(IRIs_default.owl.sameAs),
    ">": factory3.namedNode(IRIs_default.log.implies),
    "<": factory3.namedNode(IRIs_default.log.isImpliedBy)
  };
  parser.QUANTIFIERS_GRAPH = factory3.namedNode("urn:n3:quantifiers");
}
N3Parser.SUPPORTED_VERSIONS = [
  "1.2",
  "1.2-basic",
  "1.1"
];
initDataFactory(N3Parser.prototype, N3DataFactory_default);

// src/rdf/parse.js
async function parseText(text, baseIRI) {
  const parser = new N3Parser({ baseIRI, factory: env_default });
  return env_default.dataset(parser.parse(text));
}

// src/rdf/ProfileJsonLd.js
var CONTEXT = Object.freeze({
  label: vocabulary.rdfs.label,
  comment: vocabulary.rdfs.comment,
  // A set, not a list: ports are keyed by symbol and have no order.
  port: { "@id": vocabulary.lv2.port, "@container": "@set" },
  symbol: vocabulary.lv2.symbol,
  name: vocabulary.lv2.name,
  minimum: vocabulary.lv2.minimum,
  maximum: vocabulary.lv2.maximum,
  default: vocabulary.lv2.default,
  // What a bound control needs to read a port: its unit, its named values, and the port properties that choose a
  // widget (contract section 5.3). A unit and a property are IRIs, as in the profile, so a frame compares them
  // with the same table the host uses.
  unit: { "@id": vocabulary.units.unit, "@type": "@id" },
  portProperty: { "@id": vocabulary.lv2.portProperty, "@type": "@id", "@container": "@set" },
  scalePoint: { "@id": vocabulary.lv2.scalePoint, "@container": "@set" },
  value: vocabulary.rdf.value
});
function profileAsJsonLd(profile) {
  if (!profile?.iri) throw new Error("profileAsJsonLd needs a profile with an iri");
  return {
    "@context": CONTEXT,
    "@id": profile.iri,
    label: profile.label ?? null,
    comment: profile.comment ?? null,
    port: (profile.ports ?? []).map((p) => ({
      "@id": p.iri,
      symbol: p.symbol,
      name: p.name ?? p.symbol,
      minimum: p.minimum,
      maximum: p.maximum,
      default: p.defaultValue,
      comment: p.comment ?? void 0,
      unit: p.unit ?? void 0,
      portProperty: [p.toggled && vocabulary.lv2.toggled, p.enumeration && vocabulary.lv2.enumeration].filter(Boolean),
      scalePoint: p.scalePoints.map((sp) => ({ label: sp.label, value: sp.value }))
    }))
  };
}

// src/ui/PluginFrame.js
var FRAME_HEIGHT = Object.freeze({ minimum: 80, maximum: 900 });
function frameableOrigin(location, hostOrigin) {
  let url;
  try {
    url = new URL(location);
  } catch {
    return { ok: false, message: `not a URL: ${location}` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, message: `a plugin interface is fetched over http or https, not ${url.protocol}` };
  }
  return { ok: true, origin: url.origin, sameOrigin: url.origin === hostOrigin };
}
function rateLimit(limit, now) {
  let windowStart = now();
  let count = 0;
  return {
    take() {
      const t = now();
      if (t - windowStart >= 1e3) {
        windowStart = t;
        count = 0;
      }
      if (count >= limit) return false;
      count += 1;
      return true;
    }
  };
}
function createPluginFrame(document2, {
  ui,
  label,
  hostOrigin,
  window: window2,
  relayLimit: relayLimit2,
  init: init2,
  onParameter,
  onGesture = () => {
  },
  onRelay = () => {
  },
  onRefused = () => {
  },
  now = () => Date.now()
}) {
  if (!ui?.location) throw new Error("createPluginFrame needs the interface location");
  if (!Number.isInteger(relayLimit2) || relayLimit2 < 1) throw new Error("createPluginFrame needs a relayLimit of at least one per second");
  if (typeof init2 !== "function" || typeof onParameter !== "function") {
    throw new Error("createPluginFrame needs init and onParameter");
  }
  const allowed = frameableOrigin(ui.location, hostOrigin);
  if (!allowed.ok) throw new Error(allowed.message);
  const origin = allowed.origin;
  const element = document2.createElement("iframe");
  element.setAttribute("sandbox", "allow-scripts allow-same-origin");
  element.setAttribute("title", `${label} editor`);
  element.setAttribute("referrerpolicy", "no-referrer");
  element.className = "plugin-frame";
  element.style.height = `${FRAME_HEIGHT.minimum * 2}px`;
  element.src = ui.location;
  let initialised = false;
  let warned = false;
  const inbound = rateLimit(relayLimit2, now);
  const outbound = rateLimit(relayLimit2, now);
  const post = (message) => {
    element.contentWindow?.postMessage(message, origin);
  };
  const refuse = (direction) => {
    if (warned) return;
    warned = true;
    onRefused(`${label}: plugin messages ${direction} are arriving faster than ${relayLimit2} a second, and the excess is dropped`);
  };
  const listener = (event) => {
    if (event.source !== element.contentWindow || event.origin !== origin) return;
    const message = event.data;
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "ready":
        initialised = true;
        post({ type: "init", ...init2() });
        return;
      case "parameter":
        if (!initialised) return;
        if (typeof message.symbol !== "string" || !Number.isFinite(message.value)) return;
        onParameter(message.symbol, message.value);
        return;
      case "gesture":
        if (!initialised) return;
        if (typeof message.symbol !== "string" || message.phase !== "begin" && message.phase !== "end") return;
        onGesture(message.symbol, message.phase);
        return;
      case "resize": {
        if (!Number.isFinite(message.height)) return;
        const height = Math.min(FRAME_HEIGHT.maximum, Math.max(FRAME_HEIGHT.minimum, Math.round(message.height)));
        element.style.height = `${height}px`;
        return;
      }
      case "plugin":
        if (!initialised) return;
        if (!inbound.take()) {
          refuse("from the interface");
          return;
        }
        onRelay(message.payload);
        return;
      default:
    }
  };
  window2.addEventListener("message", listener);
  return {
    element,
    /** True when the interface is on this page's origin, so the sandbox is not isolation. */
    sameOrigin: allowed.sameOrigin,
    /** Tell the frame what a parameter is now, after the host applied it. */
    parameter(symbol, value) {
      if (initialised) post({ type: "parameter", symbol, value });
    },
    /** Relay a payload from the processor. */
    relay(payload) {
      if (!initialised) return;
      if (!outbound.take()) {
        refuse("from the processor");
        return;
      }
      post({ type: "plugin", payload });
    },
    dispose() {
      window2.removeEventListener("message", listener);
      element.remove();
    }
  };
}

// src/ui/Dial.js
var START_DEGREES = 135;
var SWEEP_DEGREES = 270;
var RADIUS = 38;
var CENTRE = 50;
var CIRCUMFERENCE = 2 * Math.PI * RADIUS;
var TRAVEL = 160;
var FINE = 6;
var SVG_NS2 = "http://www.w3.org/2000/svg";
var round = (n2) => Math.round(n2 * 100) / 100;
function facePoint(fraction, radius) {
  const radians = (START_DEGREES + SWEEP_DEGREES * fraction) * Math.PI / 180;
  return [round(CENTRE + radius * Math.cos(radians)), round(CENTRE + radius * Math.sin(radians))];
}
function createDial(document2, port, id, { input: adopted = null, begin = null, end = null } = {}) {
  const element = document2.createElement("div");
  element.className = "dial";
  const input = adopted ?? document2.createElement("input");
  input.type = "range";
  if (adopted === null || id) input.id = id;
  input.className = "dial-input";
  const log = port.logarithmic === true;
  const ratio = Math.log(port.maximum / port.minimum);
  const toPosition = (value2) => Math.log(Math.min(port.maximum, Math.max(port.minimum, value2)) / port.minimum) / ratio;
  const fromPosition = (position) => port.minimum * Math.exp(position * ratio);
  input.min = log ? "0" : String(port.minimum);
  input.max = log ? "1" : String(port.maximum);
  input.step = String(log ? 1 / 200 : (port.maximum - port.minimum) / 200);
  input.value = String(log ? toPosition(port.defaultValue) : port.defaultValue);
  const svg = document2.createElementNS(SVG_NS2, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("class", "dial-face");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const arc = (className) => {
    const circle = document2.createElementNS(SVG_NS2, "circle");
    circle.setAttribute("class", className);
    circle.setAttribute("cx", String(CENTRE));
    circle.setAttribute("cy", String(CENTRE));
    circle.setAttribute("r", String(RADIUS));
    circle.setAttribute("fill", "none");
    circle.setAttribute("transform", `rotate(${START_DEGREES} ${CENTRE} ${CENTRE})`);
    return circle;
  };
  const track = arc("dial-track");
  setSweep(track, 0, 1);
  const value = arc("dial-value");
  const origin = !log && port.minimum < 0 && port.maximum > 0 ? -port.minimum / (port.maximum - port.minimum) : 0;
  const pointer = document2.createElementNS(SVG_NS2, "line");
  pointer.setAttribute("class", "dial-pointer");
  pointer.setAttribute("x1", String(CENTRE));
  pointer.setAttribute("y1", String(CENTRE));
  svg.append(track, value, pointer);
  element.append(svg, input);
  function render(current) {
    const span = port.maximum - port.minimum;
    const fraction = log ? toPosition(current) : span === 0 ? 0 : Math.min(1, Math.max(0, (current - port.minimum) / span));
    setSweep(value, origin, fraction);
    const [x, y] = facePoint(fraction, RADIUS);
    pointer.setAttribute("x2", String(x));
    pointer.setAttribute("y2", String(y));
  }
  attachDrag(element, input, log ? { minimum: 0, maximum: 1 } : port, { begin, end });
  const read = () => log ? fromPosition(Number(input.value)) : Number(input.value);
  const write = (value2) => {
    input.value = String(log ? toPosition(value2) : value2);
  };
  return { element, input, render, read, write };
}
function setSweep(circle, from, to) {
  const sweep = CIRCUMFERENCE * (SWEEP_DEGREES / 360);
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  circle.setAttribute("stroke-dasharray", `${round((high - low) * sweep)} ${round(CIRCUMFERENCE)}`);
  circle.setAttribute("stroke-dashoffset", String(round(-low * sweep)));
}
function attachDrag(element, input, port, { begin = null, end: finished = null } = {}) {
  const span = port.maximum - port.minimum;
  const owner = element.ownerDocument;
  const Event = owner.defaultView?.Event;
  if (!Event) return;
  let dragging = null;
  const move = (event) => {
    if (!dragging) return;
    const sensitivity = event.shiftKey ? TRAVEL * FINE : TRAVEL;
    const moved = (dragging.y - event.clientY) / sensitivity;
    const next = Math.min(port.maximum, Math.max(port.minimum, dragging.from + moved * span));
    if (Number(input.value) === next) return;
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const end = () => {
    if (!dragging) return;
    dragging = null;
    finished?.();
    owner.removeEventListener("pointermove", move);
    owner.removeEventListener("pointerup", end);
    owner.removeEventListener("pointercancel", end);
  };
  element.addEventListener("pointerdown", (event) => {
    if (event.button !== void 0 && event.button !== 0) return;
    dragging = { y: event.clientY, from: Number(input.value) };
    begin?.();
    input.focus?.();
    event.preventDefault?.();
    owner.addEventListener("pointermove", move);
    owner.addEventListener("pointerup", end);
    owner.addEventListener("pointercancel", end);
  });
}

// src/ui/PortText.js
var UNIT_LABELS = Object.freeze({
  "http://lv2plug.in/ns/extensions/units#hz": "Hz",
  "http://lv2plug.in/ns/extensions/units#ms": "ms",
  "http://lv2plug.in/ns/extensions/units#db": "dB",
  "http://lv2plug.in/ns/extensions/units#s": "s",
  "http://lv2plug.in/ns/extensions/units#pc": "%",
  "http://lv2plug.in/ns/extensions/units#semitone12TET": "st",
  "http://lv2plug.in/ns/extensions/units#cent": "ct"
});
var formatValue = (port, value) => {
  const unit = UNIT_LABELS[port.unit];
  const decimals = port.maximum - port.minimum > 20 ? 0 : 2;
  return `${value.toFixed(decimals)}${unit ? ` ${unit}` : ""}`;
};
var SPOKEN_UNITS = Object.freeze({
  "http://lv2plug.in/ns/extensions/units#hz": "hertz",
  "http://lv2plug.in/ns/extensions/units#ms": "milliseconds",
  "http://lv2plug.in/ns/extensions/units#db": "decibels",
  "http://lv2plug.in/ns/extensions/units#s": "seconds",
  "http://lv2plug.in/ns/extensions/units#pc": "percent",
  "http://lv2plug.in/ns/extensions/units#semitone12TET": "semitones",
  "http://lv2plug.in/ns/extensions/units#cent": "cents"
});
var spokenValue = (port, value) => {
  const unit = SPOKEN_UNITS[port.unit];
  const decimals = port.maximum - port.minimum > 20 ? 0 : 2;
  return `${value.toFixed(decimals)}${unit ? ` ${unit}` : ""}`;
};

// src/ui/SkinPanel.js
var CRAMPED_OVERLAP = 0.25;
var MIN_TARGET = 44;
function overlapFraction(a2, b) {
  const w = Math.min(a2.right, b.right) - Math.max(a2.left, b.left);
  const h2 = Math.min(a2.bottom, b.bottom) - Math.max(a2.top, b.top);
  if (w <= 0 || h2 <= 0) return 0;
  return w * h2 / Math.min(a2.width * a2.height, b.width * b.height);
}
function contentWidth(element) {
  const view = element?.ownerDocument?.defaultView;
  if (!element || !view?.getComputedStyle) return 0;
  const style = view.getComputedStyle(element);
  return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}
var clamp = (n2, low, high) => Math.min(high, Math.max(low, n2));
var fractionOf = (port, value) => {
  const span = port.maximum - port.minimum;
  return span === 0 ? 0 : clamp((value - port.minimum) / span, 0, 1);
};
var withTurn = (base, turn) => [base, turn].filter(Boolean).join(" ");
var withSlide = (base, slide) => [slide, base].filter(Boolean).join(" ");
function createSkinPanel(document2, skin, onChange, { scope, measure = (el) => el.getBBox(), availableWidth = null }) {
  const wrap = document2.createElement("div");
  wrap.className = "skin";
  wrap.append(skin.svg);
  const roomFor = availableWidth ?? (() => contentWidth(wrap.parentNode));
  const natural = Number((skin.svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/)[2]);
  if (Number.isFinite(natural) && natural > 0) wrap.style.maxWidth = `${natural}px`;
  const ports = new Map(skin.ports.map((p) => [p.symbol, p]));
  const renderers = /* @__PURE__ */ new Map();
  const fitters = [];
  const hits = [];
  const bound = /* @__PURE__ */ new Set();
  const render = (symbol, fn) => {
    if (!renderers.has(symbol)) renderers.set(symbol, []);
    renderers.get(symbol).push(fn);
  };
  function hitArea(control, port, input) {
    const box = document2.createElement("div");
    box.className = "skin-hit";
    const id = `${scope}#skin-${port.symbol}`.replace(/[^\w-]/g, "_");
    input.id = id;
    input.className = "skin-input";
    input.setAttribute("aria-label", port.name ?? port.symbol);
    box.append(input);
    wrap.append(box);
    const target = skin.elements.get(control.hitElement ?? control.element);
    const hit = { box, x: 0, y: 0, width: 0, height: 0 };
    hits.push(hit);
    fitters.push(() => {
      const [vx, vy, vw, vh] = (skin.svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
      if (![vx, vy, vw, vh].every(Number.isFinite) || vw <= 0 || vh <= 0) throw new Error("a skin artwork needs a viewBox, which is what the hit areas are placed by");
      const vb = { x: vx, y: vy, width: vw, height: vh };
      const b = measure(target);
      if (!b.width && !b.height) return;
      Object.assign(hit, { x: b.x + b.width / 2, y: b.y + b.height / 2, width: b.width, height: b.height });
      box.style.left = `${(b.x + b.width / 2 - vb.x) / vb.width * 100}%`;
      box.style.top = `${(b.y + b.height / 2 - vb.y) / vb.height * 100}%`;
      box.style.width = `${b.width / vb.width * 100}%`;
      box.style.height = `${b.height / vb.height * 100}%`;
    });
    return box;
  }
  const rangeInput = (port, steps) => {
    const input = document2.createElement("input");
    input.type = "range";
    input.min = String(port.minimum);
    input.max = String(port.maximum);
    input.step = String(steps ?? (port.maximum - port.minimum) / 200);
    input.value = String(port.defaultValue);
    input.addEventListener("input", () => onChange(port.symbol, Number(input.value)));
    return input;
  };
  for (const control of skin.controls) {
    const port = ports.get(control.boundSymbol);
    const element = skin.elements.get(control.element);
    if (control.kind === "readout") {
      element.setAttribute("aria-hidden", "true");
      render(port.symbol, (v) => {
        element.textContent = formatValue(port, v);
      });
      continue;
    }
    bound.add(port.symbol);
    if (control.kind === "rotary") {
      const input = rangeInput(port);
      const box = hitArea(control, port, input);
      attachDrag(box, input, port);
      const base = element.getAttribute("transform") ?? "";
      const pivot = skin.elements.get(control.pivotElement ?? control.element);
      let centre = { x: 0, y: 0 };
      fitters.push(() => {
        const b = measure(pivot);
        if (!b.width && !b.height) return;
        centre = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      });
      render(port.symbol, (v) => {
        input.value = String(v);
        input.setAttribute("aria-valuetext", spokenValue(port, v));
        const angle = control.angleMin + (control.angleMax - control.angleMin) * fractionOf(port, v);
        element.setAttribute("transform", withTurn(base, `rotate(${angle} ${centre.x} ${centre.y})`));
      });
      fitters.push(() => {
        const v = Number(input.value);
        renderers.get(port.symbol).forEach((f) => f(v));
      });
    } else if (control.kind === "linear") {
      const input = rangeInput(port);
      const box = hitArea(control, port, input);
      const track = skin.elements.get(control.trackElement);
      const base = element.getAttribute("transform") ?? "";
      let travel = { dx: 0, dy: 0, horizontal: true };
      fitters.push(() => {
        const b = measure(track);
        if (!b.width && !b.height) return;
        const horizontal = b.width >= b.height;
        travel = { dx: horizontal ? b.width : 0, dy: horizontal ? 0 : -b.height, horizontal };
      });
      attachTrackDrag(box, input, port, track, () => travel.horizontal);
      render(port.symbol, (v) => {
        input.value = String(v);
        input.setAttribute("aria-valuetext", spokenValue(port, v));
        if (!travel.horizontal) input.setAttribute("aria-orientation", "vertical");
        const f = fractionOf(port, v);
        element.setAttribute("transform", withSlide(base, `translate(${travel.dx * f} ${travel.dy * f})`));
      });
      fitters.push(() => {
        const v = Number(input.value);
        renderers.get(port.symbol).forEach((f) => f(v));
      });
    } else if (control.kind === "toggle") {
      const input = document2.createElement("input");
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      const box = hitArea(control, port, input);
      input.addEventListener("change", () => onChange(port.symbol, input.checked ? port.maximum : port.minimum));
      box.addEventListener("click", (event) => {
        if (event.target === input) return;
        input.focus?.();
        input.checked = !input.checked;
        input.dispatchEvent(new document2.defaultView.Event("change", { bubbles: true }));
      });
      const [off, on] = [...element.children];
      render(port.symbol, (v) => {
        const isOn = v >= 0.5;
        input.checked = isOn;
        input.setAttribute("aria-checked", String(isOn));
        off.setAttribute("display", isOn ? "none" : "inline");
        on.setAttribute("display", isOn ? "inline" : "none");
      });
    } else if (control.kind === "selector") {
      const steps = port.scalePoints.length > 0 ? port.scalePoints.map((p) => p.value) : null;
      const count = steps ? steps.length : port.maximum - port.minimum + 1;
      const input = document2.createElement("input");
      input.type = "range";
      input.min = "0";
      input.max = String(count - 1);
      input.step = "1";
      input.value = "0";
      const valueOf = (index) => steps ? steps[index] : port.minimum + index;
      input.addEventListener("input", () => onChange(port.symbol, valueOf(Number(input.value))));
      const box = hitArea(control, port, input);
      box.addEventListener("click", (event) => {
        if (event.target === input) return;
        input.focus?.();
        input.value = String((Number(input.value) + 1) % count);
        input.dispatchEvent(new document2.defaultView.Event("input", { bubbles: true }));
      });
      const groups = [...element.children];
      render(port.symbol, (v) => {
        const index = Math.max(0, steps ? steps.indexOf(v) : Math.round(v - port.minimum));
        input.value = String(index);
        groups.forEach((g, i2) => g.setAttribute("display", i2 === index ? "inline" : "none"));
        input.setAttribute("aria-valuetext", port.scalePoints?.[index]?.label ?? String(valueOf(index)));
      });
    }
  }
  let cramped = false;
  const listeners = [];
  return {
    element: wrap,
    bound,
    get cramped() {
      return cramped;
    },
    /** Called with the answer after each fit, so the owner can put the drawing away when it cannot be used. */
    onCramped(fn) {
      listeners.push(fn);
    },
    update(symbol, value) {
      for (const fn of renderers.get(symbol) ?? []) fn(value);
    },
    fit() {
      for (const fn of fitters) fn();
      followThePicture(wrap, hits);
      const [, , vw] = (skin.svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
      const width = Math.min(vw, roomFor());
      const known = hits.filter((h2) => h2.width > 0 || h2.height > 0);
      if (!(width > 0) || known.length === 0) return;
      const scale = width / vw;
      const padded = known.map((h2) => {
        const w = Math.max(MIN_TARGET, h2.width * scale);
        const t = Math.max(MIN_TARGET, h2.height * scale);
        const x = h2.x * scale;
        const y = h2.y * scale;
        return { left: x - w / 2, right: x + w / 2, top: y - t / 2, bottom: y + t / 2, width: w, height: t };
      });
      cramped = padded.some((a2, i2) => padded.slice(i2 + 1).some((c3) => overlapFraction(a2, c3) > CRAMPED_OVERLAP));
      for (const fn of listeners) fn(cramped);
    }
  };
}
function followThePicture(wrap, hits) {
  const byY = [...hits].sort((a2, b) => a2.y - b.y);
  const rows = [];
  for (const hit of byY) {
    const row = rows.find((r) => Math.abs(r.y - hit.y) < Math.max(r.height, hit.height) / 2);
    if (row) row.hits.push(hit);
    else rows.push({ y: hit.y, height: hit.height, hits: [hit] });
  }
  const wanted = rows.flatMap((r) => r.hits.sort((a2, b) => a2.x - b.x)).map((h2) => h2.box);
  const current = [...wrap.children].filter((child) => wanted.includes(child));
  if (wanted.every((box, i2) => box === current[i2])) return;
  for (const box of wanted) wrap.append(box);
}
function attachTrackDrag(box, input, port, track, isHorizontal) {
  const owner = box.ownerDocument;
  const Event = owner.defaultView?.Event;
  if (!Event) return;
  let dragging = false;
  const at = (event) => {
    const r = track.getBoundingClientRect();
    const t = isHorizontal() ? (event.clientX - r.left) / r.width : (r.bottom - event.clientY) / r.height;
    const next = port.minimum + clamp(t, 0, 1) * (port.maximum - port.minimum);
    if (Number(input.value) === next) return;
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const move = (event) => {
    if (dragging) at(event);
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    owner.removeEventListener("pointermove", move);
    owner.removeEventListener("pointerup", end);
    owner.removeEventListener("pointercancel", end);
  };
  box.addEventListener("pointerdown", (event) => {
    if (event.button !== void 0 && event.button !== 0) return;
    dragging = true;
    input.focus?.();
    event.preventDefault?.();
    at(event);
    owner.addEventListener("pointermove", move);
    owner.addEventListener("pointerup", end);
    owner.addEventListener("pointercancel", end);
  });
}

// src/ui/SliderDrag.js
var THUMB = 16;
function attachSliderDrag(input, port) {
  const owner = input.ownerDocument;
  const Event = owner.defaultView?.Event;
  if (!Event) return;
  const span = port.maximum - port.minimum;
  const step = Number(input.step) > 0 ? Number(input.step) : span / 200;
  let grab = null;
  const valueAt2 = (x) => {
    const box = input.getBoundingClientRect();
    const room = box.width - THUMB;
    if (!(room > 0)) return null;
    const fraction = Math.min(1, Math.max(0, (x - box.left - THUMB / 2) / room));
    const raw = port.minimum + fraction * span;
    return Math.min(port.maximum, Math.max(port.minimum, port.minimum + Math.round((raw - port.minimum) / step) * step));
  };
  const move = (event) => {
    if (!grab) return;
    const next = valueAt2(event.clientX + grab.offset);
    if (next === null || Number(input.value) === next) return;
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const end = () => {
    if (!grab) return;
    grab = null;
    owner.removeEventListener("pointermove", move);
    owner.removeEventListener("pointerup", end);
    owner.removeEventListener("pointercancel", end);
  };
  input.addEventListener("pointerdown", (event) => {
    if (event.button !== void 0 && event.button !== 0) return;
    const box = input.getBoundingClientRect();
    const room = box.width - THUMB;
    if (!(room > 0)) return;
    const centre = box.left + THUMB / 2 + (Number(input.value) - port.minimum) / span * room;
    const onThumb = Math.abs(event.clientX - centre) <= THUMB;
    grab = { offset: onThumb ? centre - event.clientX : 0 };
    input.focus?.({ preventScroll: true });
    event.preventDefault?.();
    owner.addEventListener("pointermove", move);
    owner.addEventListener("pointerup", end);
    owner.addEventListener("pointercancel", end);
    move(event);
  });
}

// src/ui/HtmlSkinPanel.js
var HOST_SHEET = [
  ":host{display:block;contain:layout paint style;isolation:isolate;container-type:inline-size}",
  "input[type=range],select{min-height:44px}",
  // The drag is ours (SliderDrag.js), so the browser must not take a touch for a scroll halfway through it.
  "input[type=range]{touch-action:none}",
  "input[type=checkbox]{min-width:44px;min-height:44px}",
  "select{font-size:max(16px,1em)}",
  "input:focus-visible,select:focus-visible{outline:2px solid #7fb3ff;outline-offset:2px}",
  ".control-help{min-height:1.4em;margin:6px 0 0}",
  ".visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}"
].join("");
var clamp2 = (n2, low, high) => Math.min(high, Math.max(low, n2));
function createHtmlSkinPanel(document2, skin, ports, onChange, { scope }) {
  const host = document2.createElement("div");
  host.className = "skin html-skin-host";
  host.id = `${scope}#skin-host`.replace(/[^\w-]/g, "_");
  const shadow = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  const sheet = document2.createElement("style");
  sheet.textContent = `${skin.css}${HOST_SHEET}`;
  shadow.append(sheet, skin.root);
  const bySymbol = new Map(ports.map((p) => [p.symbol, p]));
  const bound = /* @__PURE__ */ new Set();
  const warnings = [];
  const setters = /* @__PURE__ */ new Map();
  const onValue = (symbol, fn) => {
    if (!setters.has(symbol)) setters.set(symbol, []);
    setters.get(symbol).push(fn);
  };
  let focused = null;
  const lines = skin.help.length ? skin.help : [Object.assign(document2.createElement("p"), { className: "control-help" })];
  if (!skin.help.length) skin.root.append(lines[0]);
  for (const line of lines) line.setAttribute("aria-hidden", "true");
  const showHelp = (port) => {
    for (const line of lines) {
      line.replaceChildren();
      if (!port?.comment) continue;
      const name = document2.createElement("b");
      name.textContent = port.name ?? port.symbol;
      line.append(name, document2.createTextNode(` ${port.comment}`));
    }
  };
  for (const { element, symbol } of skin.names) element.textContent = bySymbol.get(symbol)?.name ?? symbol;
  const labelFor = new Map([...skin.root.querySelectorAll("label[for]")].map((l) => [l.getAttribute("for"), l]));
  const namedByHost = new Set(skin.names.map((n2) => n2.element));
  for (const { element, port, kind } of skin.controls) {
    bound.add(port.symbol);
    const id = element.getAttribute("id");
    const label = id ? labelFor.get(id) : null;
    if (label && !namedByHost.has(label) && label.textContent.trim() && !port.name.toLowerCase().includes(label.textContent.trim().toLowerCase())) {
      warnings.push(`the label "${label.textContent.trim()}" is not part of the port's name "${port.name}"`);
    }
    element.setAttribute("aria-label", port.name ?? port.symbol);
    if (!id) element.setAttribute("id", `${scope}#skin-${port.symbol}`.replace(/[^\w-]/g, "_"));
    if (kind === "select") {
      element.replaceChildren(...port.scalePoints.map((sp) => Object.assign(document2.createElement("option"), { value: String(sp.value), textContent: sp.label })));
      element.addEventListener("change", () => onChange(port.symbol, Number(element.value)));
      onValue(port.symbol, (value) => {
        for (const option of element.options) option.selected = option.value === String(value);
      });
    } else if (kind === "checkbox") {
      element.addEventListener("change", () => onChange(port.symbol, element.checked ? port.maximum : port.minimum));
      onValue(port.symbol, (value) => {
        element.checked = value >= (port.minimum + port.maximum) / 2;
      });
    } else {
      element.min = String(port.minimum);
      element.max = String(port.maximum);
      element.step = String((port.maximum - port.minimum) / 200);
      element.addEventListener("input", () => onChange(port.symbol, Number(element.value)));
      attachSliderDrag(element, port);
      onValue(port.symbol, (value) => {
        element.value = String(clamp2(value, port.minimum, port.maximum));
        element.setAttribute("aria-valuetext", spokenValue(port, value));
      });
    }
    if (port.comment) {
      const words = document2.createElement("span");
      words.className = "visually-hidden";
      words.id = `${element.getAttribute("id")}-help`;
      words.textContent = port.comment;
      element.after(words);
      element.setAttribute("aria-describedby", words.id);
      element.addEventListener("pointerenter", () => showHelp(port));
      element.addEventListener("pointerleave", () => showHelp(focused));
      element.addEventListener("focus", () => {
        focused = port;
        showHelp(port);
      });
      element.addEventListener("blur", () => {
        focused = null;
        showHelp(null);
      });
      element.addEventListener("keydown", (event) => {
        if (event.key === "Escape") showHelp(null);
      });
    }
  }
  for (const { element, symbol } of skin.texts) {
    const port = bySymbol.get(symbol);
    if (!port) continue;
    element.setAttribute("aria-hidden", "true");
    onValue(symbol, (value) => {
      const named = port.scalePoints?.find((sp) => sp.value === value);
      element.textContent = named ? named.label : formatValue(port, value);
    });
  }
  let cramped = false;
  const listeners = [];
  const measure = () => {
    const room = host.clientWidth;
    if (!room) return null;
    if (skin.root.scrollWidth > room + 1) return true;
    return skin.controls.some((c3) => {
      const box = c3.element.getBoundingClientRect?.();
      return box && box.width === 0 && box.height === 0;
    });
  };
  return {
    element: host,
    bound,
    warnings,
    get cramped() {
      return cramped;
    },
    update(symbol, value) {
      for (const fn of setters.get(symbol) ?? []) fn(value);
    },
    onCramped(fn) {
      listeners.push(fn);
    },
    fit() {
      const wasHidden = host.hidden;
      host.hidden = false;
      const next = measure();
      host.hidden = wasHidden;
      if (next === null || next === cramped) return;
      cramped = next;
      for (const fn of listeners) fn(cramped);
    }
  };
}

// src/ui/PrimaryControls.js
function splitPrimary(ports) {
  const ranked = ports.filter((p) => p.displayPriority !== null && p.displayPriority !== void 0);
  if (ranked.length === 0 || ranked.length === ports.length) return { primary: ports, rest: [] };
  const order = new Map(ports.map((p, i2) => [p, i2]));
  const primary = [...ranked].sort((a2, b) => b.displayPriority - a2.displayPriority || order.get(a2) - order.get(b));
  return { primary, rest: ports.filter((p) => !ranked.includes(p)) };
}

// src/ui/Pad.js
function fractionOf2(value, port) {
  const span = port.maximum - port.minimum;
  if (!(span > 0)) return 0.5;
  return Math.min(1, Math.max(0, (value - port.minimum) / span));
}
function valueAt(fraction, port) {
  const f = Math.min(1, Math.max(0, fraction));
  return port.minimum + f * (port.maximum - port.minimum);
}
function createPad(document2, { pad, ports, onSet, id }) {
  const portX = ports.find((p) => p.symbol === pad.x);
  const portY = ports.find((p) => p.symbol === pad.y);
  if (!portX || !portY) throw new Error(`pad ${pad.label}: ${pad.x} and ${pad.y} must both be ports of the plugin`);
  const element = document2.createElement("div");
  element.className = "pad";
  element.setAttribute("role", "group");
  const captionId = `${id}-caption`;
  element.setAttribute("aria-labelledby", captionId);
  const surface = document2.createElement("div");
  surface.className = "pad-surface";
  surface.setAttribute("aria-hidden", "true");
  const puck = document2.createElement("div");
  puck.className = "pad-puck";
  surface.append(puck);
  const end = (className, text) => {
    if (!text) return;
    const label = document2.createElement("span");
    label.className = `pad-end ${className}`;
    label.textContent = text;
    surface.append(label);
  };
  end("pad-end-left", pad.xLow);
  end("pad-end-right", pad.xHigh);
  end("pad-end-bottom", pad.yLow);
  end("pad-end-top", pad.yHigh);
  const axis = (port, low, high) => `${port.name ?? port.symbol}${low && high ? `, from ${low} to ${high}` : low ? `, low is ${low}` : high ? `, high is ${high}` : ""}`;
  const caption = document2.createElement("p");
  caption.className = "pad-caption";
  caption.id = captionId;
  const name = document2.createElement("b");
  name.textContent = pad.label;
  caption.append(name, document2.createTextNode(` Across is ${axis(portX, pad.xLow, pad.xHigh)}, up is ${axis(portY, pad.yLow, pad.yHigh)}.`));
  element.append(surface, caption);
  const at = { x: 0.5, y: 0.5 };
  const place = () => {
    puck.style.left = `${at.x * 100}%`;
    puck.style.top = `${(1 - at.y) * 100}%`;
  };
  place();
  const set = (event) => {
    const box = surface.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) return;
    at.x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    at.y = Math.min(1, Math.max(0, 1 - (event.clientY - box.top) / box.height));
    place();
    const across = valueAt(at.x, portX);
    const up = valueAt(at.y, portY);
    onSet(portX.symbol, across);
    onSet(portY.symbol, up);
  };
  surface.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    set(event);
    const stop = () => {
      document2.removeEventListener("pointermove", set);
      document2.removeEventListener("pointerup", stop);
      document2.removeEventListener("pointercancel", stop);
    };
    document2.addEventListener("pointermove", set);
    document2.addEventListener("pointerup", stop);
    document2.addEventListener("pointercancel", stop);
  });
  return {
    element,
    update(symbol, value) {
      if (symbol === portX.symbol) at.x = fractionOf2(value, portX);
      else if (symbol === portY.symbol) at.y = fractionOf2(value, portY);
      else return;
      place();
    }
  };
}

// src/ui/Panel.js
function createPanel(document2, profile, onChange, onLoadAsset, { scope = profile.iri, skin = null, skinLayout = {} } = {}) {
  const root = document2.createElement("section");
  root.className = "panel";
  const heading = document2.createElement("h3");
  heading.textContent = profile.label ?? profile.iri;
  const headingId = `${scope}-heading`.replace(/[^\w-]/g, "_");
  heading.id = headingId;
  root.setAttribute("role", "group");
  root.setAttribute("aria-labelledby", headingId);
  root.append(heading);
  if (profile.kind === "foreign") {
    const mark = document2.createElement("span");
    mark.className = "foreign";
    mark.textContent = "foreign";
    mark.title = "Runs in this page with this page's privileges. It is not sandboxed.";
    heading.append(" ", mark);
    root.classList.add("is-foreign");
  }
  let helpLine = null;
  let focusedPort = null;
  if (profile.ports.some((p) => p.comment)) {
    helpLine = document2.createElement("p");
    helpLine.className = "control-help";
    helpLine.setAttribute("aria-hidden", "true");
    root.append(helpLine);
  }
  const showHelp = (port) => {
    const name = document2.createElement("b");
    name.textContent = port.name ?? port.symbol;
    helpLine.replaceChildren(name, document2.createTextNode(` ${port.comment}`));
  };
  const clearHelp = () => {
    helpLine.replaceChildren();
  };
  const settleHelp = () => {
    if (focusedPort) showHelp(focusedPort);
    else clearHelp();
  };
  const padHandles = [];
  const pads = Array.isArray(profile.pads) ? profile.pads : [];
  const padsRow = pads.length > 0 ? document2.createElement("div") : null;
  if (padsRow) {
    padsRow.className = "pads";
    root.append(padsRow);
  }
  const moved = skin ? /* @__PURE__ */ new Set() : new Set(pads.map((p) => p.choice).filter(Boolean));
  const listed = profile.ports.filter((p) => !moved.has(p.symbol));
  const setters = /* @__PURE__ */ new Map();
  const onValue = (symbol, fn) => {
    if (!setters.has(symbol)) setters.set(symbol, []);
    setters.get(symbol).push(fn);
  };
  const skinPanel = !skin ? null : skin.kind === "html" ? createHtmlSkinPanel(document2, skin, profile.ports, onChange, { scope }) : createSkinPanel(document2, { ...skin, ports: profile.ports }, onChange, { scope, ...skinLayout });
  if (skinPanel) {
    root.append(skinPanel.element);
    root.classList.add("has-skin");
    for (const port of profile.ports) skinPanel.update(port.symbol, port.defaultValue);
    const Observer = document2.defaultView?.ResizeObserver;
    if (Observer) new Observer(() => skinPanel.fit()).observe(root);
  }
  const unskinned = skinPanel ? profile.ports.filter((p) => !skinPanel.bound.has(p.symbol)) : listed;
  pads.forEach((pad, index) => {
    const handle = createPad(document2, {
      pad,
      ports: profile.ports,
      id: `${scope}-pad-${index}`.replace(/[^\w-]/g, "_"),
      // Through the same path a knob takes: the two controls draw the new value and the host is told, exactly as for a drag of either.
      onSet: (symbol, value) => {
        for (const fn of setters.get(symbol) ?? []) fn(value);
        onChange(symbol, value);
      }
    });
    const choice = moved.has(pad.choice) ? profile.ports.find((p) => p.symbol === pad.choice) : null;
    if (choice) {
      const holder = document2.createElement("div");
      holder.className = "pad-with-choice";
      const box = document2.createElement("div");
      box.className = "pad-choice";
      addControl(box, choice, "pad-");
      holder.append(handle.element, box);
      padsRow.append(holder);
    } else {
      padsRow.append(handle.element);
    }
    padHandles.push({ pad, handle });
  });
  function addControl(grid, port, tag) {
    const row = document2.createElement("div");
    row.className = `control control-${port.widget}`;
    const label = document2.createElement("label");
    const id = `${scope}#${tag}${port.symbol}`.replace(/[^\w-]/g, "_");
    label.setAttribute("for", id);
    label.textContent = port.controller == null ? port.name ?? port.symbol : `${port.name ?? port.symbol} (CC ${port.controller})`;
    row.append(label);
    const readout = document2.createElement("span");
    readout.className = "value";
    let input;
    let knob = null;
    if (port.widget === "switch") {
      input = document2.createElement("input");
      input.type = "checkbox";
      input.checked = port.defaultValue >= 0.5;
      input.addEventListener("change", () => onChange(port.symbol, input.checked ? port.maximum : port.minimum));
      onValue(port.symbol, (v) => {
        const on = v >= 0.5;
        input.checked = on;
        const named = port.scalePoints?.find((p) => p.value === (on ? port.maximum : port.minimum))?.label;
        readout.textContent = named ?? (on ? "on" : "off");
      });
    } else if (port.widget === "selector") {
      input = document2.createElement("select");
      for (const point of port.scalePoints) {
        const option = document2.createElement("option");
        option.value = String(point.value);
        option.textContent = point.label ?? String(point.value);
        input.append(option);
      }
      const select = (value) => {
        for (const option of input.options ?? input.children) {
          option.selected = Number(option.value) === Number(value);
        }
      };
      select(port.defaultValue);
      input.addEventListener("change", () => onChange(port.symbol, Number(input.value)));
      onValue(port.symbol, (v) => {
        select(v);
        readout.textContent = port.scalePoints.find((p) => p.value === v)?.label ?? String(v);
      });
    } else {
      const dial = createDial(document2, port, id);
      input = dial.input;
      input.addEventListener("input", () => onChange(port.symbol, dial.read()));
      onValue(port.symbol, (v) => {
        dial.write(v);
        readout.textContent = formatValue(port, v);
        input.setAttribute("aria-valuetext", spokenValue(port, v));
        dial.render(v);
      });
      knob = dial.element;
    }
    input.id = id;
    const readoutId = `${id}-value`;
    readout.id = readoutId;
    input.setAttribute("aria-describedby", readoutId);
    if (!port.comment && port.name) input.title = port.name;
    row.append(knob ?? input, readout);
    if (port.comment) {
      const helpId = `${id}-help`;
      const words = document2.createElement("span");
      words.className = "visually-hidden";
      words.id = helpId;
      words.textContent = port.comment;
      row.append(words);
      input.setAttribute("aria-describedby", `${readoutId} ${helpId}`);
      row.addEventListener("pointerenter", () => showHelp(port));
      row.addEventListener("pointerleave", settleHelp);
      row.addEventListener("focusin", () => {
        focusedPort = port;
        showHelp(port);
      });
      row.addEventListener("focusout", (event) => {
        if (row.contains(event.relatedTarget)) return;
        focusedPort = null;
        clearHelp();
      });
      row.addEventListener("keydown", (event) => {
        if (event.key === "Escape") clearHelp();
      });
    }
    grid.append(row);
    setters.get(port.symbol).at(-1)(port.defaultValue);
  }
  function addGrid(parent, ports, tag) {
    const controls = document2.createElement("div");
    controls.className = "controls";
    parent.append(controls);
    for (const port of ports) addControl(controls, port, tag);
  }
  function addSections(parent, ports, tag, ungroupedLegend) {
    const ungrouped = ports.filter((p) => p.group == null);
    const groups = [];
    for (const port of ports) {
      if (port.group == null) continue;
      const group = groups.find((g) => g.label === port.group);
      if (group) group.ports.push(port);
      else groups.push({ label: port.group, ports: [port] });
    }
    const fieldset = (label) => {
      const field = document2.createElement("fieldset");
      field.className = "control-group";
      const legend = document2.createElement("legend");
      legend.textContent = label;
      field.append(legend);
      parent.append(field);
      return field;
    };
    if (ungrouped.length > 0) addGrid(ungroupedLegend ? fieldset(ungroupedLegend) : parent, ungrouped, tag);
    for (const group of groups) addGrid(fieldset(group.label), group.ports, tag);
  }
  function addWithMore(parent, ports, tag, ungroupedLegend) {
    const { primary, rest } = splitPrimary(ports);
    addSections(parent, rest.length === 0 ? primary : primary.map((p) => ({ ...p, group: null })), tag, ungroupedLegend);
    if (rest.length === 0) return;
    const more = document2.createElement("details");
    more.className = "more-controls";
    const summary = document2.createElement("summary");
    summary.textContent = `More controls (${rest.length})`;
    more.append(summary);
    addSections(more, rest, tag, null);
    parent.append(more);
  }
  if (!skinPanel) addWithMore(root, listed, "", null);
  else {
    const others = document2.createElement("div");
    others.className = "skin-others";
    addWithMore(others, unskinned, "", "Other controls");
    const everything = document2.createElement("div");
    everything.className = "skin-fallback";
    everything.hidden = true;
    addWithMore(everything, profile.ports, "all-", null);
    root.append(others, everything);
    skinPanel.onCramped((cramped) => {
      skinPanel.element.hidden = cramped;
      others.hidden = cramped;
      everything.hidden = !cramped;
      root.classList.toggle("skin-cramped", cramped);
    });
  }
  for (const { pad, handle } of padHandles) {
    for (const symbol of [pad.x, pad.y]) {
      onValue(symbol, (v) => handle.update(symbol, v));
      handle.update(symbol, profile.ports.find((p) => p.symbol === symbol).defaultValue);
    }
  }
  let assetGrid = null;
  const textAreas = /* @__PURE__ */ new Map();
  for (const asset of profile.assets ?? []) {
    if (!asset.userReplaceable) continue;
    if (!assetGrid) {
      assetGrid = document2.createElement("div");
      assetGrid.className = "controls";
      root.append(assetGrid);
    }
    const key = asset.iri.split("#").pop();
    if (asset.mediaType === "text/plain") assetGrid.append(textControl(document2, key, asset, `${scope}#${key}-text`.replace(/[^\w-]/g, "_"), onLoadAsset, textAreas));
    const row = document2.createElement("div");
    row.className = "control control-asset";
    const label = document2.createElement("label");
    const id = `${scope}#${key}-asset`.replace(/[^\w-]/g, "_");
    label.setAttribute("for", id);
    label.textContent = key;
    row.append(label);
    const input = document2.createElement("input");
    input.type = "file";
    input.id = id;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) onLoadAsset?.(key, file);
    });
    row.append(input);
    assetGrid.append(row);
  }
  return {
    element: root,
    /** Called by the host when a value actually changed. */
    update(symbol, value) {
      for (const fn of setters.get(symbol) ?? []) fn(value);
      skinPanel?.update(symbol, value);
    },
    /**
     * Show the text a plugin has loaded in its text asset's area. Edits the person has not applied are kept, and the
     * status says the plugin's text changed underneath them, so typing is never thrown away.
     */
    setAssetText(key, text) {
      textAreas.get(key)?.show(text);
    },
    /** Whether a skin is drawn, so a caller can tell a panel built before its skin arrived. */
    skinned: skinPanel !== null,
    /** The skin's own view, for a caller that places it itself: a test with its own measurements. */
    skinView: skinPanel
  };
}
var encoder = new TextEncoder();
function textControl(document2, key, asset, id, onLoadAsset, registry) {
  const row = document2.createElement("div");
  row.className = "control control-text";
  const label = document2.createElement("label");
  label.setAttribute("for", id);
  label.textContent = key;
  const area = document2.createElement("textarea");
  area.id = id;
  area.rows = 6;
  area.spellcheck = false;
  area.style.cssText = "width:100%;box-sizing:border-box;font:inherit;font-size:16px";
  const hint = document2.createElement("div");
  hint.id = `${id}-hint`;
  hint.className = "control-hint";
  area.setAttribute("aria-describedby", hint.id);
  const apply = document2.createElement("button");
  apply.type = "button";
  apply.textContent = "Apply";
  apply.style.cssText = "min-height:44px;min-width:44px";
  const status2 = document2.createElement("span");
  status2.setAttribute("role", "status");
  status2.className = "control-status";
  let loaded = "";
  const bytes = () => encoder.encode(area.value).length;
  const limit = asset.maxBytes ?? null;
  const count = () => {
    hint.textContent = limit === null ? `${bytes()} bytes` : `${bytes()} of ${limit} bytes`;
    hint.classList.toggle("over", limit !== null && bytes() > limit);
  };
  area.addEventListener("input", count);
  const send = async () => {
    if (limit !== null && bytes() > limit) {
      status2.textContent = `Not applied: ${bytes()} bytes is over the limit of ${limit}.`;
      return;
    }
    const text = area.value;
    const result = await onLoadAsset?.(key, new Blob([encoder.encode(text)], { type: "text/plain" }));
    if (result && result.ok === false) {
      status2.textContent = `Not applied: ${result.message}`;
      return;
    }
    loaded = text;
    status2.textContent = "Applied.";
  };
  apply.addEventListener("click", () => {
    send();
  });
  area.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      send();
    }
  });
  registry.set(key, {
    show(text) {
      if (area.value !== loaded && area.value !== text) {
        status2.textContent = "The plugin's text changed. Your edits are kept; Apply replaces it.";
        return;
      }
      loaded = text;
      area.value = text;
      count();
    }
  });
  count();
  row.append(label, area, hint, apply, status2);
  return row;
}

// node_modules/@rdfjs/dataset/Factory.js
var Factory6 = class {
  dataset(quads) {
    return new DatasetCore_default(quads);
  }
};
Factory6.exports = ["dataset"];
var Factory_default8 = Factory6;

// node_modules/rdf-validate-shacl/src/defaultEnv.js
var defaultEnv_default = new Environment_default([
  Factory_default,
  Factory_default8,
  Factory_default3,
  Factory_default4,
  Factory_default5
]);

// node_modules/rdf-validate-shacl/src/namespaces.js
function prepareNamespaces(factory3) {
  return {
    sh: namespace_default("http://www.w3.org/ns/shacl#", { factory: factory3 }),
    xsd: namespace_default("http://www.w3.org/2001/XMLSchema#", { factory: factory3 }),
    rdf: namespace_default("http://www.w3.org/1999/02/22-rdf-syntax-ns#", { factory: factory3 }),
    rdfs: namespace_default("http://www.w3.org/2000/01/rdf-schema#", { factory: factory3 }),
    owl: namespace_default("http://www.w3.org/2002/07/owl#", { factory: factory3 })
  };
}
var namespaces_default = prepareNamespaces();

// node_modules/@vocabulary/sh/index.js
var sh_default = ({ factory: factory3 }) => {
  const f = factory3;
  const ns1 = "http://www.w3.org/ns/shacl#";
  const ns2 = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
  const ns3 = "http://www.w3.org/2002/07/owl#";
  const ns4 = "http://www.w3.org/2000/01/rdf-schema#";
  const ns5 = "http://www.w3.org/ns/shacl-shacl#";
  const ns6 = "http://www.w3.org/2001/XMLSchema#";
  const ns7 = "http://datashapes.org/dash#";
  const blankNodes = [];
  for (let i2 = 0; i2 < 76; i2++) {
    blankNodes.push(f.blankNode());
  }
  return [
    f.quad(f.namedNode(ns1), f.namedNode(`${ns2}type`), f.namedNode(`${ns3}Ontology`), f.namedNode(ns1)),
    f.quad(f.namedNode(ns1), f.namedNode(`${ns4}comment`), f.literal("This vocabulary defines terms used in SHACL, the W3C Shapes Constraint Language.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(ns1), f.namedNode(`${ns4}label`), f.literal("W3C Shapes Constraint Language (SHACL) Vocabulary", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(ns1), f.namedNode(`${ns1}declare`), blankNodes[0], f.namedNode(ns1)),
    f.quad(f.namedNode(ns1), f.namedNode(`${ns1}suggestedShapesGraph`), f.namedNode(ns5), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}AbstractResult`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}AbstractResult`), f.namedNode(`${ns4}comment`), f.literal("The base class of validation results, typically not instantiated directly.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}AbstractResult`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}AbstractResult`), f.namedNode(`${ns4}label`), f.literal("Abstract result", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}AbstractResult`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}AndConstraintComponent-and`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}AndConstraintComponent-and`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}AndConstraintComponent-and`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}and`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}AndConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}AndConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to test whether a value node conforms to all members of a provided list of shapes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}AndConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}AndConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("And constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}AndConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}AndConstraintComponent-and`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}BlankNode`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeKind`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}BlankNode`), f.namedNode(`${ns4}comment`), f.literal("The node kind of all blank nodes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}BlankNode`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}BlankNode`), f.namedNode(`${ns4}label`), f.literal("Blank node", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}BlankNodeOrIRI`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeKind`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}BlankNodeOrIRI`), f.namedNode(`${ns4}comment`), f.literal("The node kind of all blank nodes or IRIs.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}BlankNodeOrIRI`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}BlankNodeOrIRI`), f.namedNode(`${ns4}label`), f.literal("Blank node or IRI", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}BlankNodeOrLiteral`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeKind`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}BlankNodeOrLiteral`), f.namedNode(`${ns4}comment`), f.literal("The node kind of all blank nodes or literals.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}BlankNodeOrLiteral`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}BlankNodeOrLiteral`), f.namedNode(`${ns4}label`), f.literal("Blank node or literal", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClassConstraintComponent-class`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClassConstraintComponent-class`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClassConstraintComponent-class`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}IRI`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClassConstraintComponent-class`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClassConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClassConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to verify that each value node is an instance of a given type.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClassConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClassConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Class constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClassConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}ClassConstraintComponent-class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClosedConstraintComponent-closed`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClosedConstraintComponent-closed`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClosedConstraintComponent-closed`), f.namedNode(`${ns1}datatype`), f.namedNode(`${ns6}boolean`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClosedConstraintComponent-closed`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}closed`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClosedConstraintComponent-ignoredProperties`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClosedConstraintComponent-ignoredProperties`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClosedConstraintComponent-ignoredProperties`), f.namedNode(`${ns1}optional`), f.literal("true", f.namedNode(`${ns6}boolean`)), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClosedConstraintComponent-ignoredProperties`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}ignoredProperties`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClosedConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClosedConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to indicate that focus nodes must only have values for those properties that have been explicitly enumerated via sh:property/sh:path.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClosedConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClosedConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Closed constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClosedConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}ClosedConstraintComponent-closed`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ClosedConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}ClosedConstraintComponent-ignoredProperties`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("The class of constraint components.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}Parameterizable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}CountExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}CountExpression`), f.namedNode(`${ns4}comment`), f.literal("A count expression is a blank node with exactly one value for the property sh:count which is a well-formed node expression."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}CountExpression`), f.namedNode(`${ns4}label`), f.literal("Count Expression"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}CountExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}CountExpression`), f.namedNode(`${ns1}property`), blankNodes[1], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}CountExpression`), f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns1}count`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DatatypeConstraintComponent-datatype`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DatatypeConstraintComponent-datatype`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DatatypeConstraintComponent-datatype`), f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DatatypeConstraintComponent-datatype`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}IRI`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DatatypeConstraintComponent-datatype`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}datatype`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DatatypeConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DatatypeConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to restrict the datatype of all value nodes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DatatypeConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DatatypeConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Datatype constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DatatypeConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}DatatypeConstraintComponent-datatype`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DisjointConstraintComponent-disjoint`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DisjointConstraintComponent-disjoint`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DisjointConstraintComponent-disjoint`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}IRI`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DisjointConstraintComponent-disjoint`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}disjoint`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DisjointConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DisjointConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to verify that the set of value nodes is disjoint with the the set of nodes that have the focus node as subject and the value of a given property as predicate.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DisjointConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DisjointConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Disjoint constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DisjointConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}DisjointConstraintComponent-disjoint`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DistinctExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DistinctExpression`), f.namedNode(`${ns4}comment`), f.literal("A distinct expression is a blank node with exactly one value for the property sh:distinct which is a well-formed node expression."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DistinctExpression`), f.namedNode(`${ns4}label`), f.literal("Distinct Expression"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DistinctExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DistinctExpression`), f.namedNode(`${ns1}property`), blankNodes[2], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}DistinctExpression`), f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns1}distinct`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}EqualsConstraintComponent-equals`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}EqualsConstraintComponent-equals`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}EqualsConstraintComponent-equals`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}IRI`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}EqualsConstraintComponent-equals`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}equals`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}EqualsConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}EqualsConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to verify that the set of value nodes is equal to the set of nodes that have the focus node as subject and the value of a given property as predicate.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}EqualsConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}EqualsConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Equals constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}EqualsConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}EqualsConstraintComponent-equals`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ExistsExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ExistsExpression`), f.namedNode(`${ns4}comment`), f.literal("An exists expression is a blank node with exactly one value for sh:exists (which is a well-formed shape)."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ExistsExpression`), f.namedNode(`${ns4}label`), f.literal("Exists Expression"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ExistsExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ExistsExpression`), f.namedNode(`${ns1}property`), blankNodes[3], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ExistsExpression`), f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns1}exists`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ExpressionConstraintComponent-expression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ExpressionConstraintComponent-expression`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ExpressionConstraintComponent-expression`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}expression`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ExpressionConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ExpressionConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to verify that a given node expression produces true for all value nodes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ExpressionConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ExpressionConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Expression constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ExpressionConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}ExpressionConstraintComponent-expression`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}FilterShapeExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}FilterShapeExpression`), f.namedNode(`${ns4}comment`), f.literal("A filter shape expression is a blank node with exactly one value for sh:filterShape (which is a well-formed shape) and at most one value for sh:nodes (which is a well-formed node expression)."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}FilterShapeExpression`), f.namedNode(`${ns4}label`), f.literal("Filter Shape Expression"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}FilterShapeExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}FilterShapeExpression`), f.namedNode(`${ns1}property`), blankNodes[4], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}FilterShapeExpression`), f.namedNode(`${ns1}property`), blankNodes[5], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}FilterShapeExpression`), f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns1}filterShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}FocusNodeOrConstantTermExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}FocusNodeOrConstantTermExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}IRIOrLiteral`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Function`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Function`), f.namedNode(`${ns4}comment`), f.literal("The class of SHACL functions.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Function`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Function`), f.namedNode(`${ns4}label`), f.literal("Function", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Function`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}Parameterizable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}FunctionExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}FunctionExpression`), f.namedNode(`${ns4}comment`), f.literal("A function expression is a blank node that does not fulfill any of the syntax rules of the other node expression types and which is the subject of exactly one triple T where the object is a well-formed SHACL list, and each member of that list is a well-formed node expression."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}FunctionExpression`), f.namedNode(`${ns4}label`), f.literal("Function Expression"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}FunctionExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}GroupConcatExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}GroupConcatExpression`), f.namedNode(`${ns4}comment`), f.literal("A group concat expression is a blank node with exactly one value for the property sh:groupConcat which is a well-formed node expression. A group concat expression can have a single value for the property sh:separator which is literal with datatype xsd:string."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}GroupConcatExpression`), f.namedNode(`${ns4}label`), f.literal("Group Concat Expression"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}GroupConcatExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}GroupConcatExpression`), f.namedNode(`${ns1}property`), blankNodes[6], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}GroupConcatExpression`), f.namedNode(`${ns1}property`), blankNodes[7], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}GroupConcatExpression`), f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns1}groupConcat`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}HasValueConstraintComponent-hasValue`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}HasValueConstraintComponent-hasValue`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}HasValueConstraintComponent-hasValue`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}hasValue`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}HasValueConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}HasValueConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to verify that one of the value nodes is a given RDF node.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}HasValueConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}HasValueConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Has-value constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}HasValueConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}HasValueConstraintComponent-hasValue`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IRI`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeKind`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IRI`), f.namedNode(`${ns4}comment`), f.literal("The node kind of all IRIs.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IRI`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IRI`), f.namedNode(`${ns4}label`), f.literal("IRI", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IRIOrLiteral`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeKind`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IRIOrLiteral`), f.namedNode(`${ns4}comment`), f.literal("The node kind of all IRIs or literals.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IRIOrLiteral`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IRIOrLiteral`), f.namedNode(`${ns4}label`), f.literal("IRI or literal", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IfExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IfExpression`), f.namedNode(`${ns4}comment`), f.literal("An if expression is a blank node with exactly one value for sh:if (which is a well-formed node expression), at most one value for sh:then (which is a well-formed node expression) and at most one value for sh:else (which is a well-formed node expression)."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IfExpression`), f.namedNode(`${ns4}label`), f.literal("If Expression"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IfExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IfExpression`), f.namedNode(`${ns1}property`), blankNodes[8], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IfExpression`), f.namedNode(`${ns1}property`), blankNodes[9], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IfExpression`), f.namedNode(`${ns1}property`), blankNodes[10], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IfExpression`), f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns1}else`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IfExpression`), f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns1}if`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IfExpression`), f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns1}then`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}InConstraintComponent-in`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}InConstraintComponent-in`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}InConstraintComponent-in`), f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}InConstraintComponent-in`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}in`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}InConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}InConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to exclusively enumerate the permitted value nodes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}InConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}InConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("In constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}InConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}InConstraintComponent-in`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Info`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Severity`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Info`), f.namedNode(`${ns4}comment`), f.literal("The severity for an informational validation result.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Info`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Info`), f.namedNode(`${ns4}label`), f.literal("Info", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IntersectionExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IntersectionExpression`), f.namedNode(`${ns4}comment`), f.literal("An intersection expression is a blank node with exactly one value for the property sh:intersection which is a well-formed SHACL list with at least two members (which are well-formed node expressions)."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IntersectionExpression`), f.namedNode(`${ns4}label`), f.literal("Intersection Expression"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IntersectionExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IntersectionExpression`), f.namedNode(`${ns1}property`), blankNodes[11], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}IntersectionExpression`), f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns1}intersection`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSConstraint-js`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSConstraint-js`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSConstraint-js`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}js`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSConstraint`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSConstraint`), f.namedNode(`${ns4}comment`), f.literal("The class of constraints backed by a JavaScript function.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSConstraint`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSConstraint`), f.namedNode(`${ns4}label`), f.literal("JavaScript-based constraint", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSConstraint`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}JSExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component with the parameter sh:js linking to a sh:JSConstraint containing a sh:script.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("JavaScript constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}JSConstraint-js`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSExecutable`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSExecutable`), f.namedNode(`${ns4}comment`), f.literal("Abstract base class of resources that declare an executable JavaScript.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSExecutable`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSExecutable`), f.namedNode(`${ns4}label`), f.literal("JavaScript executable", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSExecutable`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSFunction`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSFunction`), f.namedNode(`${ns4}comment`), f.literal("The class of SHACL functions that execute a JavaScript function when called.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSFunction`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSFunction`), f.namedNode(`${ns4}label`), f.literal("JavaScript function", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSFunction`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}Function`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSFunction`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}JSExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSLibrary`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSLibrary`), f.namedNode(`${ns4}comment`), f.literal("Represents a JavaScript library, typically identified by one or more URLs of files to include.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSLibrary`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSLibrary`), f.namedNode(`${ns4}label`), f.literal("JavaScript library", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSLibrary`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSRule`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSRule`), f.namedNode(`${ns4}comment`), f.literal("The class of SHACL rules expressed using JavaScript.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSRule`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSRule`), f.namedNode(`${ns4}label`), f.literal("JavaScript rule", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSRule`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}JSExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSRule`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}Rule`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSTarget`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSTarget`), f.namedNode(`${ns4}comment`), f.literal("The class of targets that are based on JavaScript functions.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSTarget`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSTarget`), f.namedNode(`${ns4}label`), f.literal("JavaScript target", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSTarget`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}JSExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSTarget`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}Target`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSTargetType`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSTargetType`), f.namedNode(`${ns4}comment`), f.literal("The (meta) class for parameterizable targets that are based on JavaScript functions.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSTargetType`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSTargetType`), f.namedNode(`${ns4}label`), f.literal("JavaScript target type", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSTargetType`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}JSExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSTargetType`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}TargetType`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSValidator`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSValidator`), f.namedNode(`${ns4}comment`), f.literal("A SHACL validator based on JavaScript. This can be used to declare SHACL constraint components that perform JavaScript-based validation when used.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSValidator`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSValidator`), f.namedNode(`${ns4}label`), f.literal("JavaScript validator", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSValidator`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}JSExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}JSValidator`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}Validator`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LanguageInConstraintComponent-languageIn`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LanguageInConstraintComponent-languageIn`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LanguageInConstraintComponent-languageIn`), f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LanguageInConstraintComponent-languageIn`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}languageIn`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LanguageInConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LanguageInConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to enumerate language tags that all value nodes must have.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LanguageInConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LanguageInConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Language-in constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LanguageInConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}LanguageInConstraintComponent-languageIn`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LessThanConstraintComponent-lessThan`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LessThanConstraintComponent-lessThan`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LessThanConstraintComponent-lessThan`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}IRI`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LessThanConstraintComponent-lessThan`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}lessThan`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LessThanConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LessThanConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to verify that each value node is smaller than all the nodes that have the focus node as subject and the value of a given property as predicate.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LessThanConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LessThanConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Less-than constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LessThanConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}LessThanConstraintComponent-lessThan`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LessThanOrEqualsConstraintComponent-lessThanOrEquals`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LessThanOrEqualsConstraintComponent-lessThanOrEquals`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LessThanOrEqualsConstraintComponent-lessThanOrEquals`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}IRI`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LessThanOrEqualsConstraintComponent-lessThanOrEquals`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}lessThanOrEquals`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LessThanOrEqualsConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LessThanOrEqualsConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to verify that every value node is smaller than all the nodes that have the focus node as subject and the value of a given property as predicate.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LessThanOrEqualsConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LessThanOrEqualsConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("less-than-or-equals constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LessThanOrEqualsConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}LessThanOrEqualsConstraintComponent-lessThanOrEquals`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LimitExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LimitExpression`), f.namedNode(`${ns4}comment`), f.literal("A limit expression is a blank node with exactly one value for the property sh:limit which is a literal with datatype xsd:integer and with exactly one value for the property sh:nodes which is a well-formed node expression."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LimitExpression`), f.namedNode(`${ns4}label`), f.literal("Limit Expression"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LimitExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LimitExpression`), f.namedNode(`${ns1}property`), blankNodes[12], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LimitExpression`), f.namedNode(`${ns1}property`), blankNodes[13], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}LimitExpression`), f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns1}limit`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Literal`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeKind`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Literal`), f.namedNode(`${ns4}comment`), f.literal("The node kind of all literals.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Literal`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Literal`), f.namedNode(`${ns4}label`), f.literal("Literal", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxCountConstraintComponent-maxCount`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxCountConstraintComponent-maxCount`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxCountConstraintComponent-maxCount`), f.namedNode(`${ns1}datatype`), f.namedNode(`${ns6}integer`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxCountConstraintComponent-maxCount`), f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxCountConstraintComponent-maxCount`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}maxCount`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxCountConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxCountConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to restrict the maximum number of value nodes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxCountConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxCountConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Max-count constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxCountConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}MaxCountConstraintComponent-maxCount`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxExclusiveConstraintComponent-maxExclusive`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxExclusiveConstraintComponent-maxExclusive`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxExclusiveConstraintComponent-maxExclusive`), f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxExclusiveConstraintComponent-maxExclusive`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}Literal`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxExclusiveConstraintComponent-maxExclusive`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}maxExclusive`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxExclusiveConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxExclusiveConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to restrict the range of value nodes with a maximum exclusive value.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxExclusiveConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxExclusiveConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Max-exclusive constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxExclusiveConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}MaxExclusiveConstraintComponent-maxExclusive`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxExpression`), f.namedNode(`${ns4}comment`), f.literal("A max expression is a blank node with exactly one value for the property sh:max which is a well-formed node expression."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxExpression`), f.namedNode(`${ns4}label`), f.literal("Max Expression"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxExpression`), f.namedNode(`${ns1}property`), blankNodes[14], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxExpression`), f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns1}max`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxInclusiveConstraintComponent-maxInclusive`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxInclusiveConstraintComponent-maxInclusive`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxInclusiveConstraintComponent-maxInclusive`), f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxInclusiveConstraintComponent-maxInclusive`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}Literal`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxInclusiveConstraintComponent-maxInclusive`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}maxInclusive`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxInclusiveConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxInclusiveConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to restrict the range of value nodes with a maximum inclusive value.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxInclusiveConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxInclusiveConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Max-inclusive constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxInclusiveConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}MaxInclusiveConstraintComponent-maxInclusive`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxLengthConstraintComponent-maxLength`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxLengthConstraintComponent-maxLength`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxLengthConstraintComponent-maxLength`), f.namedNode(`${ns1}datatype`), f.namedNode(`${ns6}integer`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxLengthConstraintComponent-maxLength`), f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxLengthConstraintComponent-maxLength`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}maxLength`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxLengthConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxLengthConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to restrict the maximum string length of value nodes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxLengthConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxLengthConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Max-length constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MaxLengthConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}MaxLengthConstraintComponent-maxLength`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinCountConstraintComponent-minCount`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinCountConstraintComponent-minCount`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinCountConstraintComponent-minCount`), f.namedNode(`${ns1}datatype`), f.namedNode(`${ns6}integer`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinCountConstraintComponent-minCount`), f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinCountConstraintComponent-minCount`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}minCount`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinCountConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinCountConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to restrict the minimum number of value nodes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinCountConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinCountConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Min-count constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinCountConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}MinCountConstraintComponent-minCount`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinExclusiveConstraintComponent-minExclusive`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinExclusiveConstraintComponent-minExclusive`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinExclusiveConstraintComponent-minExclusive`), f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinExclusiveConstraintComponent-minExclusive`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}Literal`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinExclusiveConstraintComponent-minExclusive`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}minExclusive`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinExclusiveConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinExclusiveConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to restrict the range of value nodes with a minimum exclusive value.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinExclusiveConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinExclusiveConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Min-exclusive constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinExclusiveConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}MinExclusiveConstraintComponent-minExclusive`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinExpression`), f.namedNode(`${ns4}comment`), f.literal("A min expression is a blank node with exactly one value for the property sh:min which is a well-formed node expression."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinExpression`), f.namedNode(`${ns4}label`), f.literal("Min Expression"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinExpression`), f.namedNode(`${ns1}property`), blankNodes[15], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinExpression`), f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns1}min`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinInclusiveConstraintComponent-minInclusive`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinInclusiveConstraintComponent-minInclusive`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinInclusiveConstraintComponent-minInclusive`), f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinInclusiveConstraintComponent-minInclusive`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}Literal`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinInclusiveConstraintComponent-minInclusive`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}minInclusive`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinInclusiveConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinInclusiveConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to restrict the range of value nodes with a minimum inclusive value.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinInclusiveConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinInclusiveConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Min-inclusive constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinInclusiveConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}MinInclusiveConstraintComponent-minInclusive`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinLengthConstraintComponent-minLength`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinLengthConstraintComponent-minLength`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinLengthConstraintComponent-minLength`), f.namedNode(`${ns1}datatype`), f.namedNode(`${ns6}integer`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinLengthConstraintComponent-minLength`), f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinLengthConstraintComponent-minLength`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}minLength`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinLengthConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinLengthConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to restrict the minimum string length of value nodes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinLengthConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinLengthConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Min-length constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinLengthConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}MinLengthConstraintComponent-minLength`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinusExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinusExpression`), f.namedNode(`${ns4}comment`), f.literal("A minus expression is a blank node with exactly one value for the property sh:minus which is a well-formed node expression and exactly one value for the property sh:nodes which is a well-formed node expression."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinusExpression`), f.namedNode(`${ns4}label`), f.literal("Minus Expression"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinusExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinusExpression`), f.namedNode(`${ns1}property`), blankNodes[16], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinusExpression`), f.namedNode(`${ns1}property`), blankNodes[17], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}MinusExpression`), f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns1}minus`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeConstraintComponent-node`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeConstraintComponent-node`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeConstraintComponent-node`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}node`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to verify that all value nodes conform to the given node shape.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Node constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}NodeConstraintComponent-node`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeExpression`), f.namedNode(`${ns1}targetObjectsOf`), f.namedNode(`${ns1}expression`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeExpression`), f.namedNode(`${ns1}targetObjectsOf`), f.namedNode(`${ns1}values`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeExpression`), f.namedNode(`${ns1}xone`), blankNodes[18], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeKind`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeKind`), f.namedNode(`${ns4}comment`), f.literal("The class of all node kinds, including sh:BlankNode, sh:IRI, sh:Literal or the combinations of these: sh:BlankNodeOrIRI, sh:BlankNodeOrLiteral, sh:IRIOrLiteral.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeKind`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeKind`), f.namedNode(`${ns4}label`), f.literal("Node kind", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeKind`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeKindConstraintComponent-nodeKind`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeKindConstraintComponent-nodeKind`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeKindConstraintComponent-nodeKind`), f.namedNode(`${ns1}in`), blankNodes[19], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeKindConstraintComponent-nodeKind`), f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeKindConstraintComponent-nodeKind`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}nodeKind`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeKindConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeKindConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to restrict the RDF node kind of each value node.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeKindConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeKindConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Node-kind constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeKindConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}NodeKindConstraintComponent-nodeKind`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeShape`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeShape`), f.namedNode(`${ns4}comment`), f.literal("A node shape is a shape that specifies constraint that need to be met with respect to focus nodes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeShape`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeShape`), f.namedNode(`${ns4}label`), f.literal("Node shape", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NodeShape`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}Shape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NotConstraintComponent-not`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NotConstraintComponent-not`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NotConstraintComponent-not`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}not`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NotConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NotConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to verify that value nodes do not conform to a given shape.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NotConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NotConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Not constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}NotConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}NotConstraintComponent-not`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OffsetExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OffsetExpression`), f.namedNode(`${ns4}comment`), f.literal("An offset expression is a blank node with exactly one value for the property sh:offset which is a literal with datatype xsd:integer and with exactly one value for the property sh:nodes which is a well-formed node expression."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OffsetExpression`), f.namedNode(`${ns4}label`), f.literal("Offset Expression"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OffsetExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OffsetExpression`), f.namedNode(`${ns1}property`), blankNodes[20], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OffsetExpression`), f.namedNode(`${ns1}property`), blankNodes[21], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OffsetExpression`), f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns1}offset`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OrConstraintComponent-or`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OrConstraintComponent-or`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OrConstraintComponent-or`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}or`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OrConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OrConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to restrict the value nodes so that they conform to at least one out of several provided shapes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OrConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OrConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Or constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OrConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}OrConstraintComponent-or`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OrderByExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OrderByExpression`), f.namedNode(`${ns4}comment`), f.literal("An orderBy expression is a blank node with exactly one value for the property sh:orderBy which is a well-formed node expression and with exactly one value for the property sh:nodes which is a well-formed node expression. An orderBy expression can have one value for the property sh:desc which is either true or false."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OrderByExpression`), f.namedNode(`${ns4}label`), f.literal("OrderBy Expression"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OrderByExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OrderByExpression`), f.namedNode(`${ns1}property`), blankNodes[22], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OrderByExpression`), f.namedNode(`${ns1}property`), blankNodes[23], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OrderByExpression`), f.namedNode(`${ns1}property`), blankNodes[24], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}OrderByExpression`), f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns1}orderBy`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Parameter`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Parameter`), f.namedNode(`${ns4}comment`), f.literal("The class of parameter declarations, consisting of a path predicate and (possibly) information about allowed value type, cardinality and other characteristics.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Parameter`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Parameter`), f.namedNode(`${ns4}label`), f.literal("Parameter", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Parameter`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}PropertyShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Parameterizable`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Parameterizable`), f.namedNode(`${ns4}comment`), f.literal("Superclass of components that can take parameters, especially functions and constraint components.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Parameterizable`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Parameterizable`), f.namedNode(`${ns4}label`), f.literal("Parameterizable", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Parameterizable`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PathExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PathExpression`), f.namedNode(`${ns4}comment`), f.literal("A path expression is a blank node with exactly one value of the property sh:path (which are well-formed property paths) and at most one value for sh:nodes (which is a well-formed node expression)."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PathExpression`), f.namedNode(`${ns4}label`), f.literal("Path Expression"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PathExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PathExpression`), f.namedNode(`${ns1}property`), blankNodes[25], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PathExpression`), f.namedNode(`${ns1}property`), blankNodes[26], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PatternConstraintComponent-flags`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PatternConstraintComponent-flags`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PatternConstraintComponent-flags`), f.namedNode(`${ns1}datatype`), f.namedNode(`${ns6}string`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PatternConstraintComponent-flags`), f.namedNode(`${ns1}optional`), f.literal("true", f.namedNode(`${ns6}boolean`)), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PatternConstraintComponent-flags`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}flags`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PatternConstraintComponent-pattern`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PatternConstraintComponent-pattern`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PatternConstraintComponent-pattern`), f.namedNode(`${ns1}datatype`), f.namedNode(`${ns6}string`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PatternConstraintComponent-pattern`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}pattern`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PatternConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PatternConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to verify that every value node matches a given regular expression.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PatternConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PatternConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Pattern constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PatternConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}PatternConstraintComponent-flags`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PatternConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}PatternConstraintComponent-pattern`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PrefixDeclaration`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PrefixDeclaration`), f.namedNode(`${ns4}comment`), f.literal("The class of prefix declarations, consisting of pairs of a prefix with a namespace.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PrefixDeclaration`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PrefixDeclaration`), f.namedNode(`${ns4}label`), f.literal("Prefix declaration", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PrefixDeclaration`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PropertyConstraintComponent-property`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PropertyConstraintComponent-property`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PropertyConstraintComponent-property`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PropertyConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PropertyConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to verify that all value nodes conform to the given property shape.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PropertyConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PropertyConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Property constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PropertyConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}PropertyConstraintComponent-property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PropertyGroup`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PropertyGroup`), f.namedNode(`${ns4}comment`), f.literal("Instances of this class represent groups of property shapes that belong together.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PropertyGroup`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PropertyGroup`), f.namedNode(`${ns4}label`), f.literal("Property group", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PropertyGroup`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PropertyShape`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PropertyShape`), f.namedNode(`${ns4}comment`), f.literal("A property shape is a shape that specifies constraints on the values of a focus node for a given property or path.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PropertyShape`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PropertyShape`), f.namedNode(`${ns4}label`), f.literal("Property shape", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}PropertyShape`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}Shape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent-qualifiedMaxCount`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent-qualifiedMaxCount`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent-qualifiedMaxCount`), f.namedNode(`${ns1}datatype`), f.namedNode(`${ns6}integer`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent-qualifiedMaxCount`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}qualifiedMaxCount`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent-qualifiedValueShape`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent-qualifiedValueShape`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent-qualifiedValueShape`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}qualifiedValueShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent-qualifiedValueShapesDisjoint`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent-qualifiedValueShapesDisjoint`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent-qualifiedValueShapesDisjoint`), f.namedNode(`${ns1}datatype`), f.namedNode(`${ns6}boolean`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent-qualifiedValueShapesDisjoint`), f.namedNode(`${ns1}optional`), f.literal("true", f.namedNode(`${ns6}boolean`)), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent-qualifiedValueShapesDisjoint`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}qualifiedValueShapesDisjoint`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to verify that a specified maximum number of value nodes conforms to a given shape.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Qualified-max-count constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent-qualifiedMaxCount`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent-qualifiedValueShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}QualifiedMaxCountConstraintComponent-qualifiedValueShapesDisjoint`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMinCountConstraintComponent-qualifiedMinCount`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMinCountConstraintComponent-qualifiedMinCount`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMinCountConstraintComponent-qualifiedMinCount`), f.namedNode(`${ns1}datatype`), f.namedNode(`${ns6}integer`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMinCountConstraintComponent-qualifiedMinCount`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}qualifiedMinCount`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMinCountConstraintComponent-qualifiedValueShape`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMinCountConstraintComponent-qualifiedValueShape`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMinCountConstraintComponent-qualifiedValueShape`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}qualifiedValueShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMinCountConstraintComponent-qualifiedValueShapesDisjoint`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMinCountConstraintComponent-qualifiedValueShapesDisjoint`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMinCountConstraintComponent-qualifiedValueShapesDisjoint`), f.namedNode(`${ns1}datatype`), f.namedNode(`${ns6}boolean`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMinCountConstraintComponent-qualifiedValueShapesDisjoint`), f.namedNode(`${ns1}optional`), f.literal("true", f.namedNode(`${ns6}boolean`)), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMinCountConstraintComponent-qualifiedValueShapesDisjoint`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}qualifiedValueShapesDisjoint`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMinCountConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMinCountConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to verify that a specified minimum number of value nodes conforms to a given shape.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMinCountConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMinCountConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Qualified-min-count constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMinCountConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}QualifiedMinCountConstraintComponent-qualifiedMinCount`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMinCountConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}QualifiedMinCountConstraintComponent-qualifiedValueShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}QualifiedMinCountConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}QualifiedMinCountConstraintComponent-qualifiedValueShapesDisjoint`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ResultAnnotation`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ResultAnnotation`), f.namedNode(`${ns4}comment`), f.literal("A class of result annotations, which define the rules to derive the values of a given annotation property as extra values for a validation result.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ResultAnnotation`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ResultAnnotation`), f.namedNode(`${ns4}label`), f.literal("Result annotation", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ResultAnnotation`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Rule`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Rule`), f.namedNode(`${ns4}comment`), f.literal("The class of SHACL rules. Never instantiated directly.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Rule`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Rule`), f.namedNode(`${ns4}label`), f.literal("Rule", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Rule`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLAskExecutable`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLAskExecutable`), f.namedNode(`${ns4}comment`), f.literal("The class of SPARQL executables that are based on an ASK query.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLAskExecutable`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLAskExecutable`), f.namedNode(`${ns4}label`), f.literal("SPARQL ASK executable", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLAskExecutable`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}SPARQLExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLAskExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLAskExpression`), f.namedNode(`${ns4}comment`), f.literal("A SPARQL ASK expression is a blank node with exactly one value for the property sh:ask which is string literal. The blank node may have values for the property sh:prefixes and these values are IRIs or blank nodes. Using the values of sh:prefixes as defined by 5.2.1 Prefix Declarations for SPARQL Queries, the value of sh:ask must be valid SPARQL 1.1 ASK query. The blank node may also have exactly one value for the property sh:nodes which is a well-formed node expression."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLAskExpression`), f.namedNode(`${ns4}label`), f.literal("SPARQL ASK Expression"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLAskExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLAskExpression`), f.namedNode(`${ns1}property`), blankNodes[27], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLAskExpression`), f.namedNode(`${ns1}property`), blankNodes[28], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLAskExpression`), f.namedNode(`${ns1}property`), blankNodes[29], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLAskExpression`), f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns1}ask`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLAskValidator`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLAskValidator`), f.namedNode(`${ns4}comment`), f.literal("The class of validators based on SPARQL ASK queries. The queries are evaluated for each value node and are supposed to return true if the given node conforms.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLAskValidator`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLAskValidator`), f.namedNode(`${ns4}label`), f.literal("SPARQL ASK validator", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLAskValidator`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}SPARQLAskExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLAskValidator`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}Validator`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLConstraint`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLConstraint`), f.namedNode(`${ns4}comment`), f.literal("The class of constraints based on SPARQL SELECT queries.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLConstraint`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLConstraint`), f.namedNode(`${ns4}label`), f.literal("SPARQL constraint", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLConstraint`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}SPARQLSelectExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLConstraintComponent-sparql`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLConstraintComponent-sparql`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLConstraintComponent-sparql`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}sparql`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to define constraints based on SPARQL queries.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("SPARQL constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}SPARQLConstraintComponent-sparql`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLConstructExecutable`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLConstructExecutable`), f.namedNode(`${ns4}comment`), f.literal("The class of SPARQL executables that are based on a CONSTRUCT query.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLConstructExecutable`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLConstructExecutable`), f.namedNode(`${ns4}label`), f.literal("SPARQL CONSTRUCT executable", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLConstructExecutable`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}SPARQLExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLExecutable`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLExecutable`), f.namedNode(`${ns4}comment`), f.literal("The class of resources that encapsulate a SPARQL query.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLExecutable`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLExecutable`), f.namedNode(`${ns4}label`), f.literal("SPARQL executable", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLExecutable`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLFunction`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLFunction`), f.namedNode(`${ns4}comment`), f.literal("A function backed by a SPARQL query - either ASK or SELECT.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLFunction`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLFunction`), f.namedNode(`${ns4}label`), f.literal("SPARQL function", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLFunction`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}Function`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLFunction`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}SPARQLAskExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLFunction`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}SPARQLSelectExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLRule`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLRule`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLRule`), f.namedNode(`${ns4}comment`), f.literal("The class of SHACL rules based on SPARQL CONSTRUCT queries.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLRule`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLRule`), f.namedNode(`${ns4}label`), f.literal("SPARQL CONSTRUCT rule", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLRule`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}Rule`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLRule`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}SPARQLConstructExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLRule`), f.namedNode(`${ns1}property`), blankNodes[30], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLRule`), f.namedNode(`${ns1}property`), blankNodes[31], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLSelectExecutable`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLSelectExecutable`), f.namedNode(`${ns4}comment`), f.literal("The class of SPARQL executables based on a SELECT query.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLSelectExecutable`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLSelectExecutable`), f.namedNode(`${ns4}label`), f.literal("SPARQL SELECT executable", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLSelectExecutable`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}SPARQLExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLSelectExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLSelectExpression`), f.namedNode(`${ns4}comment`), f.literal("A SPARQL SELECT expression is a blank node with exactly one value for the property sh:select which is string literal. The blank node may have values for the property sh:prefixes and these values are IRIs or blank nodes. Using the values of sh:prefixes as defined by 5.2.1 Prefix Declarations for SPARQL Queries, the value of sh:select must be valid SPARQL 1.1 SELECT query with exactly one result variable. The blank node may also have exactly one value for the property sh:nodes which is a well-formed node expression."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLSelectExpression`), f.namedNode(`${ns4}label`), f.literal("SPARQL SELECT Expression"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLSelectExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLSelectExpression`), f.namedNode(`${ns1}property`), blankNodes[32], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLSelectExpression`), f.namedNode(`${ns1}property`), blankNodes[33], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLSelectExpression`), f.namedNode(`${ns1}property`), blankNodes[34], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLSelectExpression`), f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns1}select`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLSelectValidator`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLSelectValidator`), f.namedNode(`${ns4}comment`), f.literal("The class of validators based on SPARQL SELECT queries. The queries are evaluated for each focus node and are supposed to produce bindings for all focus nodes that do not conform.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLSelectValidator`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLSelectValidator`), f.namedNode(`${ns4}label`), f.literal("SPARQL SELECT validator", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLSelectValidator`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}SPARQLSelectExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLSelectValidator`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}Validator`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLTarget`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLTarget`), f.namedNode(`${ns4}comment`), f.literal("The class of targets that are based on SPARQL queries.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLTarget`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLTarget`), f.namedNode(`${ns4}label`), f.literal("SPARQL target", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLTarget`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}SPARQLAskExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLTarget`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}SPARQLSelectExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLTarget`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}Target`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLTargetType`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLTargetType`), f.namedNode(`${ns4}comment`), f.literal("The (meta) class for parameterizable targets that are based on SPARQL queries.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLTargetType`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLTargetType`), f.namedNode(`${ns4}label`), f.literal("SPARQL target type", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLTargetType`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}SPARQLAskExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLTargetType`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}SPARQLSelectExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLTargetType`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}TargetType`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLUpdateExecutable`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLUpdateExecutable`), f.namedNode(`${ns4}comment`), f.literal("The class of SPARQL executables based on a SPARQL UPDATE.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLUpdateExecutable`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLUpdateExecutable`), f.namedNode(`${ns4}label`), f.literal("SPARQL UPDATE executable", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SPARQLUpdateExecutable`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}SPARQLExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Severity`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Severity`), f.namedNode(`${ns4}comment`), f.literal("The class of validation result severity levels, including violation and warning levels.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Severity`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Severity`), f.namedNode(`${ns4}label`), f.literal("Severity", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Severity`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Shape`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Shape`), f.namedNode(`${ns4}comment`), f.literal("A shape is a collection of constraints that may be targeted for certain nodes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Shape`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Shape`), f.namedNode(`${ns4}label`), f.literal("Shape", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Shape`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SumExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SumExpression`), f.namedNode(`${ns4}comment`), f.literal("A sum expression is a blank node with exactly one value for the property sh:sum which is a well-formed node expression."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SumExpression`), f.namedNode(`${ns4}label`), f.literal("Sum Expression"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SumExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SumExpression`), f.namedNode(`${ns1}property`), blankNodes[35], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}SumExpression`), f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns1}sum`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Target`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Target`), f.namedNode(`${ns4}comment`), f.literal("The base class of targets such as those based on SPARQL queries.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Target`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Target`), f.namedNode(`${ns4}label`), f.literal("Target", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Target`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}TargetType`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}TargetType`), f.namedNode(`${ns4}comment`), f.literal("The (meta) class for parameterizable targets.	Instances of this are instantiated as values of the sh:target property.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}TargetType`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}TargetType`), f.namedNode(`${ns4}label`), f.literal("Target type", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}TargetType`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}TargetType`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}Parameterizable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}TripleRule`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}TripleRule`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}TripleRule`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}TripleRule`), f.namedNode(`${ns4}label`), f.literal("A rule based on triple (subject, predicate, object) pattern.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}TripleRule`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}Rule`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}TripleRule`), f.namedNode(`${ns1}property`), blankNodes[36], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}TripleRule`), f.namedNode(`${ns1}property`), blankNodes[37], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}TripleRule`), f.namedNode(`${ns1}property`), blankNodes[38], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}UnionExpression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}UnionExpression`), f.namedNode(`${ns4}comment`), f.literal("A union expression is a blank node with exactly one value for the property sh:union which is a well-formed SHACL list with at least two members (which are well-formed node expressions)."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}UnionExpression`), f.namedNode(`${ns4}label`), f.literal("Union Expression"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}UnionExpression`), f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}UnionExpression`), f.namedNode(`${ns1}property`), blankNodes[39], f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}UnionExpression`), f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns1}union`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}UniqueLangConstraintComponent-uniqueLang`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}UniqueLangConstraintComponent-uniqueLang`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}UniqueLangConstraintComponent-uniqueLang`), f.namedNode(`${ns1}datatype`), f.namedNode(`${ns6}boolean`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}UniqueLangConstraintComponent-uniqueLang`), f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}UniqueLangConstraintComponent-uniqueLang`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}uniqueLang`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}UniqueLangConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}UniqueLangConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to specify that no pair of value nodes may use the same language tag.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}UniqueLangConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}UniqueLangConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Unique-languages constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}UniqueLangConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}UniqueLangConstraintComponent-uniqueLang`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ValidationReport`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ValidationReport`), f.namedNode(`${ns4}comment`), f.literal("The class of SHACL validation reports.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ValidationReport`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ValidationReport`), f.namedNode(`${ns4}label`), f.literal("Validation report", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ValidationReport`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ValidationResult`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ValidationResult`), f.namedNode(`${ns4}comment`), f.literal("The class of validation results.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ValidationResult`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ValidationResult`), f.namedNode(`${ns4}label`), f.literal("Validation result", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ValidationResult`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns1}AbstractResult`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Validator`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Validator`), f.namedNode(`${ns4}comment`), f.literal("The class of validators, which provide instructions on how to process a constraint definition. This class serves as base class for the SPARQL-based validators and other possible implementations.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Validator`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Validator`), f.namedNode(`${ns4}label`), f.literal("Validator", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Validator`), f.namedNode(`${ns4}subClassOf`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Violation`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Severity`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Violation`), f.namedNode(`${ns4}comment`), f.literal("The severity for a violation validation result.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Violation`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Violation`), f.namedNode(`${ns4}label`), f.literal("Violation", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Warning`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Severity`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Warning`), f.namedNode(`${ns4}comment`), f.literal("The severity for a warning validation result.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Warning`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}Warning`), f.namedNode(`${ns4}label`), f.literal("Warning", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}XoneConstraintComponent-xone`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}XoneConstraintComponent-xone`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}XoneConstraintComponent-xone`), f.namedNode(`${ns1}path`), f.namedNode(`${ns1}xone`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}XoneConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}XoneConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("A constraint component that can be used to restrict the value nodes so that they conform to exactly one out of several provided shapes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}XoneConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}XoneConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("Exactly one constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}XoneConstraintComponent`), f.namedNode(`${ns1}parameter`), f.namedNode(`${ns1}XoneConstraintComponent-xone`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}alternativePath`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}alternativePath`), f.namedNode(`${ns4}comment`), f.literal("The (single) value of this property must be a list of path elements, representing the elements of alternative paths.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}alternativePath`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}alternativePath`), f.namedNode(`${ns4}label`), f.literal("alternative path", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}alternativePath`), f.namedNode(`${ns4}range`), f.namedNode(`${ns2}List`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}and`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}and`), f.namedNode(`${ns4}comment`), f.literal("RDF list of shapes to validate the value nodes against.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}and`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}and`), f.namedNode(`${ns4}label`), f.literal("and", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}and`), f.namedNode(`${ns4}range`), f.namedNode(`${ns2}List`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}annotationProperty`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}annotationProperty`), f.namedNode(`${ns4}comment`), f.literal("The annotation property that shall be set.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}annotationProperty`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}ResultAnnotation`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}annotationProperty`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}annotationProperty`), f.namedNode(`${ns4}label`), f.literal("annotation property", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}annotationProperty`), f.namedNode(`${ns4}range`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}annotationValue`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}annotationValue`), f.namedNode(`${ns4}comment`), f.literal("The (default) values of the annotation property.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}annotationValue`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}ResultAnnotation`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}annotationValue`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}annotationValue`), f.namedNode(`${ns4}label`), f.literal("annotation value", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}annotationVarName`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}annotationVarName`), f.namedNode(`${ns4}comment`), f.literal("The name of the SPARQL variable from the SELECT clause that shall be used for the values.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}annotationVarName`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}ResultAnnotation`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}annotationVarName`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}annotationVarName`), f.namedNode(`${ns4}label`), f.literal("annotation variable name", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}annotationVarName`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}string`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ask`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ask`), f.namedNode(`${ns4}comment`), f.literal("The SPARQL ASK query to execute.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ask`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}SPARQLAskExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ask`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ask`), f.namedNode(`${ns4}label`), f.literal("ask", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ask`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}string`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}class`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}class`), f.namedNode(`${ns4}comment`), f.literal("The type that all value nodes must have.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}class`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}class`), f.namedNode(`${ns4}label`), f.literal("class", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}class`), f.namedNode(`${ns4}range`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}closed`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}closed`), f.namedNode(`${ns4}comment`), f.literal("If set to true then the shape is closed.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}closed`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}closed`), f.namedNode(`${ns4}label`), f.literal("closed", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}closed`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}boolean`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}condition`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}condition`), f.namedNode(`${ns4}comment`), f.literal("The shapes that the focus nodes need to conform to before a rule is executed on them.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}condition`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}Rule`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}condition`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}condition`), f.namedNode(`${ns4}label`), f.literal("condition", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}condition`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}Shape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}conforms`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}conforms`), f.namedNode(`${ns4}comment`), f.literal("True if the validation did not produce any validation results, and false otherwise.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}conforms`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}ValidationReport`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}conforms`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}conforms`), f.namedNode(`${ns4}label`), f.literal("conforms", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}conforms`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}boolean`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}construct`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}construct`), f.namedNode(`${ns4}comment`), f.literal("The SPARQL CONSTRUCT query to execute.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}construct`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}SPARQLConstructExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}construct`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}construct`), f.namedNode(`${ns4}label`), f.literal("construct", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}construct`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}string`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}count`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}datatype`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}datatype`), f.namedNode(`${ns4}comment`), f.literal("Specifies an RDF datatype that all value nodes must have.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}datatype`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}datatype`), f.namedNode(`${ns4}label`), f.literal("datatype", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}datatype`), f.namedNode(`${ns4}range`), f.namedNode(`${ns4}Datatype`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}deactivated`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}deactivated`), f.namedNode(`${ns4}comment`), f.literal("If set to true then all nodes conform to this.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}deactivated`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}deactivated`), f.namedNode(`${ns4}label`), f.literal("deactivated", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}deactivated`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}boolean`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}declare`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}declare`), f.namedNode(`${ns4}comment`), f.literal("Links a resource with its namespace prefix declarations.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}declare`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns3}Ontology`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}declare`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}declare`), f.namedNode(`${ns4}label`), f.literal("declare", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}declare`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}PrefixDeclaration`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}defaultValue`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}defaultValue`), f.namedNode(`${ns4}comment`), f.literal("A default value for a property, for example for user interface tools to pre-populate input fields.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}defaultValue`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}PropertyShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}defaultValue`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}defaultValue`), f.namedNode(`${ns4}label`), f.literal("default value", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}desc`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}description`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}description`), f.namedNode(`${ns4}comment`), f.literal("Human-readable descriptions for the property in the context of the surrounding shape.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}description`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}PropertyShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}description`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}description`), f.namedNode(`${ns4}label`), f.literal("description", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}detail`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}detail`), f.namedNode(`${ns4}comment`), f.literal("Links a result with other results that provide more details, for example to describe violations against nested shapes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}detail`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}AbstractResult`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}detail`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}detail`), f.namedNode(`${ns4}label`), f.literal("detail", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}detail`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}AbstractResult`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}disjoint`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}disjoint`), f.namedNode(`${ns4}comment`), f.literal("Specifies a property where the set of values must be disjoint with the value nodes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}disjoint`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}disjoint`), f.namedNode(`${ns4}label`), f.literal("disjoint", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}disjoint`), f.namedNode(`${ns4}range`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}distinct`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}else`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}entailment`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}entailment`), f.namedNode(`${ns4}comment`), f.literal("An entailment regime that indicates what kind of inferencing is required by a shapes graph.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}entailment`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns3}Ontology`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}entailment`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}entailment`), f.namedNode(`${ns4}label`), f.literal("entailment", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}entailment`), f.namedNode(`${ns4}range`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}equals`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}equals`), f.namedNode(`${ns4}comment`), f.literal("Specifies a property that must have the same values as the value nodes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}equals`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}equals`), f.namedNode(`${ns4}label`), f.literal("equals", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}equals`), f.namedNode(`${ns4}range`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}exists`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}expression`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}expression`), f.namedNode(`${ns4}comment`), f.literal("The node expression that must return true for the value nodes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}expression`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}expression`), f.namedNode(`${ns4}label`), f.literal("expression", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}filterShape`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}filterShape`), f.namedNode(`${ns4}comment`), f.literal("The shape that all input nodes of the expression need to conform to.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}filterShape`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}filterShape`), f.namedNode(`${ns4}label`), f.literal("filter shape", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}filterShape`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}Shape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}flags`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}flags`), f.namedNode(`${ns4}comment`), f.literal("An optional flag to be used with regular expression pattern matching.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}flags`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}flags`), f.namedNode(`${ns4}label`), f.literal("flags", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}flags`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}string`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}focusNode`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}focusNode`), f.namedNode(`${ns4}comment`), f.literal("The focus node that was validated when the result was produced.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}focusNode`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}AbstractResult`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}focusNode`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}focusNode`), f.namedNode(`${ns4}label`), f.literal("focus node", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}group`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}group`), f.namedNode(`${ns4}comment`), f.literal("Can be used to link to a property group to indicate that a property shape belongs to a group of related property shapes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}group`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}PropertyShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}group`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}group`), f.namedNode(`${ns4}label`), f.literal("group", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}group`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}PropertyGroup`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}groupConcat`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}hasValue`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}hasValue`), f.namedNode(`${ns4}comment`), f.literal("Specifies a value that must be among the value nodes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}hasValue`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}hasValue`), f.namedNode(`${ns4}label`), f.literal("has value", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}if`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ignoredProperties`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ignoredProperties`), f.namedNode(`${ns4}comment`), f.literal("An optional RDF list of properties that are also permitted in addition to those explicitly enumerated via sh:property/sh:path.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ignoredProperties`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ignoredProperties`), f.namedNode(`${ns4}label`), f.literal("ignored properties", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}ignoredProperties`), f.namedNode(`${ns4}range`), f.namedNode(`${ns2}List`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}in`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}in`), f.namedNode(`${ns4}comment`), f.literal("Specifies a list of allowed values so that each value node must be among the members of the given list.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}in`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}in`), f.namedNode(`${ns4}label`), f.literal("in", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}in`), f.namedNode(`${ns4}range`), f.namedNode(`${ns2}List`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}intersection`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}intersection`), f.namedNode(`${ns4}comment`), f.literal("A list of node expressions that shall be intersected.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}intersection`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}intersection`), f.namedNode(`${ns4}label`), f.literal("intersection", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}inversePath`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}inversePath`), f.namedNode(`${ns4}comment`), f.literal("The (single) value of this property represents an inverse path (object to subject).", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}inversePath`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}inversePath`), f.namedNode(`${ns4}label`), f.literal("inverse path", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}inversePath`), f.namedNode(`${ns4}range`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}js`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}js`), f.namedNode(`${ns4}comment`), f.literal("Constraints expressed in JavaScript."), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}js`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}js`), f.namedNode(`${ns4}label`), f.literal("JavaScript constraint", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}js`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}JSConstraint`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}jsFunctionName`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}jsFunctionName`), f.namedNode(`${ns4}comment`), f.literal("The name of the JavaScript function to execute.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}jsFunctionName`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}JSExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}jsFunctionName`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}jsFunctionName`), f.namedNode(`${ns4}label`), f.literal("JavaScript function name", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}jsFunctionName`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}string`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}jsLibrary`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}jsLibrary`), f.namedNode(`${ns4}comment`), f.literal("Declares which JavaScript libraries are needed to execute this.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}jsLibrary`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}jsLibrary`), f.namedNode(`${ns4}label`), f.literal("JavaScript library", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}jsLibrary`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}JSLibrary`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}jsLibraryURL`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}jsLibraryURL`), f.namedNode(`${ns4}comment`), f.literal("Declares the URLs of a JavaScript library. This should be the absolute URL of a JavaScript file. Implementations may redirect those to local files.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}jsLibraryURL`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}JSLibrary`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}jsLibraryURL`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}jsLibraryURL`), f.namedNode(`${ns4}label`), f.literal("JavaScript library URL", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}jsLibraryURL`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}anyURI`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}labelTemplate`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}labelTemplate`), f.namedNode(`${ns4}comment`), f.literal("Outlines how human-readable labels of instances of the associated Parameterizable shall be produced. The values can contain {?paramName} as placeholders for the actual values of the given parameter.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}labelTemplate`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}Parameterizable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}labelTemplate`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}labelTemplate`), f.namedNode(`${ns4}label`), f.literal("label template", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}languageIn`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}languageIn`), f.namedNode(`${ns4}comment`), f.literal("Specifies a list of language tags that all value nodes must have.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}languageIn`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}languageIn`), f.namedNode(`${ns4}label`), f.literal("language in", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}languageIn`), f.namedNode(`${ns4}range`), f.namedNode(`${ns2}List`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}lessThan`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}lessThan`), f.namedNode(`${ns4}comment`), f.literal("Specifies a property that must have smaller values than the value nodes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}lessThan`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}lessThan`), f.namedNode(`${ns4}label`), f.literal("less than", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}lessThan`), f.namedNode(`${ns4}range`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}lessThanOrEquals`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}lessThanOrEquals`), f.namedNode(`${ns4}comment`), f.literal("Specifies a property that must have smaller or equal values than the value nodes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}lessThanOrEquals`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}lessThanOrEquals`), f.namedNode(`${ns4}label`), f.literal("less than or equals", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}lessThanOrEquals`), f.namedNode(`${ns4}range`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}limit`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}max`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}maxCount`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}maxCount`), f.namedNode(`${ns4}comment`), f.literal("Specifies the maximum number of values in the set of value nodes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}maxCount`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}maxCount`), f.namedNode(`${ns4}label`), f.literal("max count", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}maxCount`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}integer`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}maxExclusive`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}maxExclusive`), f.namedNode(`${ns4}comment`), f.literal("Specifies the maximum exclusive value of each value node.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}maxExclusive`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}maxExclusive`), f.namedNode(`${ns4}label`), f.literal("max exclusive", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}maxInclusive`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}maxInclusive`), f.namedNode(`${ns4}comment`), f.literal("Specifies the maximum inclusive value of each value node.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}maxInclusive`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}maxInclusive`), f.namedNode(`${ns4}label`), f.literal("max inclusive", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}maxLength`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}maxLength`), f.namedNode(`${ns4}comment`), f.literal("Specifies the maximum string length of each value node.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}maxLength`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}maxLength`), f.namedNode(`${ns4}label`), f.literal("max length", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}maxLength`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}integer`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}message`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}message`), f.namedNode(`${ns4}comment`), f.literal("A human-readable message (possibly with placeholders for variables) explaining the cause of the result.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}message`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}message`), f.namedNode(`${ns4}label`), f.literal("message", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}min`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}minCount`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}minCount`), f.namedNode(`${ns4}comment`), f.literal("Specifies the minimum number of values in the set of value nodes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}minCount`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}minCount`), f.namedNode(`${ns4}label`), f.literal("min count", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}minCount`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}integer`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}minExclusive`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}minExclusive`), f.namedNode(`${ns4}comment`), f.literal("Specifies the minimum exclusive value of each value node.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}minExclusive`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}minExclusive`), f.namedNode(`${ns4}label`), f.literal("min exclusive", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}minInclusive`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}minInclusive`), f.namedNode(`${ns4}comment`), f.literal("Specifies the minimum inclusive value of each value node.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}minInclusive`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}minInclusive`), f.namedNode(`${ns4}label`), f.literal("min inclusive", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}minLength`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}minLength`), f.namedNode(`${ns4}comment`), f.literal("Specifies the minimum string length of each value node.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}minLength`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}minLength`), f.namedNode(`${ns4}label`), f.literal("min length", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}minLength`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}integer`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}minus`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}name`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}name`), f.namedNode(`${ns4}comment`), f.literal("Human-readable labels for the property in the context of the surrounding shape.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}name`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}PropertyShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}name`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}name`), f.namedNode(`${ns4}label`), f.literal("name", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}namespace`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}namespace`), f.namedNode(`${ns4}comment`), f.literal("The namespace associated with a prefix in a prefix declaration.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}namespace`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}PrefixDeclaration`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}namespace`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}namespace`), f.namedNode(`${ns4}label`), f.literal("namespace", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}namespace`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}anyURI`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}node`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}node`), f.namedNode(`${ns4}comment`), f.literal("Specifies the node shape that all value nodes must conform to.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}node`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}node`), f.namedNode(`${ns4}label`), f.literal("node", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}node`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}NodeShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns4}comment`), f.literal("Specifies the node kind (e.g. IRI or literal) each value node.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns4}label`), f.literal("node kind", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}NodeKind`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}nodeValidator`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}nodeValidator`), f.namedNode(`${ns4}comment`), f.literal("The validator(s) used to evaluate a constraint in the context of a node shape.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}nodeValidator`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}nodeValidator`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}nodeValidator`), f.namedNode(`${ns4}label`), f.literal("shape validator", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}nodeValidator`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}Validator`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}nodes`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}nodes`), f.namedNode(`${ns4}comment`), f.literal("The node expression producing the input nodes of a filter shape expression.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}nodes`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}nodes`), f.namedNode(`${ns4}label`), f.literal("nodes", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}not`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}not`), f.namedNode(`${ns4}comment`), f.literal("Specifies a shape that the value nodes must not conform to.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}not`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}not`), f.namedNode(`${ns4}label`), f.literal("not", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}not`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}Shape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}object`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}object`), f.namedNode(`${ns4}comment`), f.literal("An expression producing the nodes that shall be inferred as objects.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}object`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}TripleRule`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}object`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}object`), f.namedNode(`${ns4}label`), f.literal("object", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}offset`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}oneOrMorePath`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}oneOrMorePath`), f.namedNode(`${ns4}comment`), f.literal("The (single) value of this property represents a path that is matched one or more times.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}oneOrMorePath`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}oneOrMorePath`), f.namedNode(`${ns4}label`), f.literal("one or more path", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}oneOrMorePath`), f.namedNode(`${ns4}range`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}optional`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}optional`), f.namedNode(`${ns4}comment`), f.literal("Indicates whether a parameter is optional.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}optional`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}optional`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}optional`), f.namedNode(`${ns4}label`), f.literal("optional", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}optional`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}boolean`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}or`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}or`), f.namedNode(`${ns4}comment`), f.literal("Specifies a list of shapes so that the value nodes must conform to at least one of the shapes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}or`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}or`), f.namedNode(`${ns4}label`), f.literal("or", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}or`), f.namedNode(`${ns4}range`), f.namedNode(`${ns2}List`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}order`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}order`), f.namedNode(`${ns4}comment`), f.literal("Specifies the relative order of this compared to its siblings. For example use 0 for the first, 1 for the second.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}order`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}order`), f.namedNode(`${ns4}label`), f.literal("order", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}orderBy`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}parameter`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}parameter`), f.namedNode(`${ns4}comment`), f.literal("The parameters of a function or constraint component.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}parameter`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}Parameterizable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}parameter`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}parameter`), f.namedNode(`${ns4}label`), f.literal("parameter", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}parameter`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}Parameter`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}path`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}path`), f.namedNode(`${ns4}comment`), f.literal("Specifies the property path of a property shape.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}path`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}PropertyShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}path`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}path`), f.namedNode(`${ns4}label`), f.literal("path", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}path`), f.namedNode(`${ns4}range`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}pattern`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}pattern`), f.namedNode(`${ns4}comment`), f.literal("Specifies a regular expression pattern that the string representations of the value nodes must match.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}pattern`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}pattern`), f.namedNode(`${ns4}label`), f.literal("pattern", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}pattern`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}string`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}predicate`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}predicate`), f.namedNode(`${ns4}comment`), f.literal("An expression producing the properties that shall be inferred as predicates.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}predicate`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}TripleRule`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}predicate`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}predicate`), f.namedNode(`${ns4}label`), f.literal("predicate", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}prefix`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}prefix`), f.namedNode(`${ns4}comment`), f.literal("The prefix of a prefix declaration.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}prefix`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}PrefixDeclaration`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}prefix`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}prefix`), f.namedNode(`${ns4}label`), f.literal("prefix", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}prefix`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}string`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}prefixes`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}prefixes`), f.namedNode(`${ns4}comment`), f.literal("The prefixes that shall be applied before parsing the associated SPARQL query.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}prefixes`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}SPARQLExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}prefixes`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}prefixes`), f.namedNode(`${ns4}label`), f.literal("prefixes", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}prefixes`), f.namedNode(`${ns4}range`), f.namedNode(`${ns3}Ontology`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}property`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}property`), f.namedNode(`${ns4}comment`), f.literal("Links a shape to its property shapes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}property`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}Shape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}property`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}property`), f.namedNode(`${ns4}label`), f.literal("property", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}property`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}PropertyShape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}propertyValidator`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}propertyValidator`), f.namedNode(`${ns4}comment`), f.literal("The validator(s) used to evaluate a constraint in the context of a property shape.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}propertyValidator`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}propertyValidator`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}propertyValidator`), f.namedNode(`${ns4}label`), f.literal("property validator", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}propertyValidator`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}Validator`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedMaxCount`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedMaxCount`), f.namedNode(`${ns4}comment`), f.literal("The maximum number of value nodes that can conform to the shape.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedMaxCount`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedMaxCount`), f.namedNode(`${ns4}label`), f.literal("qualified max count", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedMaxCount`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}integer`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedMinCount`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedMinCount`), f.namedNode(`${ns4}comment`), f.literal("The minimum number of value nodes that must conform to the shape.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedMinCount`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedMinCount`), f.namedNode(`${ns4}label`), f.literal("qualified min count", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedMinCount`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}integer`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedValueShape`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedValueShape`), f.namedNode(`${ns4}comment`), f.literal("The shape that a specified number of values must conform to.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedValueShape`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedValueShape`), f.namedNode(`${ns4}label`), f.literal("qualified value shape", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedValueShape`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}Shape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedValueShapesDisjoint`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedValueShapesDisjoint`), f.namedNode(`${ns4}comment`), f.literal("Can be used to mark the qualified value shape to be disjoint with its sibling shapes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedValueShapesDisjoint`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedValueShapesDisjoint`), f.namedNode(`${ns4}label`), f.literal("qualified value shapes disjoint", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}qualifiedValueShapesDisjoint`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}boolean`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}result`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}result`), f.namedNode(`${ns4}comment`), f.literal("The validation results contained in a validation report.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}result`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}ValidationReport`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}result`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}result`), f.namedNode(`${ns4}label`), f.literal("result", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}result`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}ValidationResult`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultAnnotation`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultAnnotation`), f.namedNode(`${ns4}comment`), f.literal("Links a SPARQL validator with zero or more sh:ResultAnnotation instances, defining how to derive additional result properties based on the variables of the SELECT query.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultAnnotation`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}SPARQLSelectValidator`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultAnnotation`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultAnnotation`), f.namedNode(`${ns4}label`), f.literal("result annotation", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultAnnotation`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}ResultAnnotation`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultMessage`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultMessage`), f.namedNode(`${ns4}comment`), f.literal("Human-readable messages explaining the cause of the result.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultMessage`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}AbstractResult`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultMessage`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultMessage`), f.namedNode(`${ns4}label`), f.literal("result message", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultPath`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultPath`), f.namedNode(`${ns4}comment`), f.literal("The path of a validation result, based on the path of the validated property shape.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultPath`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}AbstractResult`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultPath`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultPath`), f.namedNode(`${ns4}label`), f.literal("result path", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultPath`), f.namedNode(`${ns4}range`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultSeverity`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultSeverity`), f.namedNode(`${ns4}comment`), f.literal("The severity of the result, e.g. warning.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultSeverity`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}AbstractResult`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultSeverity`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultSeverity`), f.namedNode(`${ns4}label`), f.literal("result severity", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}resultSeverity`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}Severity`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}returnType`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}returnType`), f.namedNode(`${ns4}comment`), f.literal("The expected type of values returned by the associated function.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}returnType`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}Function`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}returnType`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}returnType`), f.namedNode(`${ns4}label`), f.literal("return type", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}returnType`), f.namedNode(`${ns4}range`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}rule`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}rule`), f.namedNode(`${ns4}comment`), f.literal("The rules linked to a shape.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}rule`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}Shape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}rule`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}rule`), f.namedNode(`${ns4}label`), f.literal("rule", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}rule`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}Rule`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}select`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}select`), f.namedNode(`${ns4}comment`), f.literal("The SPARQL SELECT query to execute.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}select`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}SPARQLSelectExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}select`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}select`), f.namedNode(`${ns4}label`), f.literal("select", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}select`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}string`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}separator`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}severity`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}severity`), f.namedNode(`${ns4}comment`), f.literal("Defines the severity that validation results produced by a shape must have. Defaults to sh:Violation.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}severity`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}Shape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}severity`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}severity`), f.namedNode(`${ns4}label`), f.literal("severity", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}severity`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}Severity`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}shapesGraph`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}shapesGraph`), f.namedNode(`${ns4}comment`), f.literal("Shapes graphs that should be used when validating this data graph.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}shapesGraph`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns3}Ontology`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}shapesGraph`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}shapesGraph`), f.namedNode(`${ns4}label`), f.literal("shapes graph", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}shapesGraph`), f.namedNode(`${ns4}range`), f.namedNode(`${ns3}Ontology`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}shapesGraphWellFormed`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}shapesGraphWellFormed`), f.namedNode(`${ns4}comment`), f.literal("If true then the validation engine was certain that the shapes graph has passed all SHACL syntax requirements during the validation process.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}shapesGraphWellFormed`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}ValidationReport`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}shapesGraphWellFormed`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}shapesGraphWellFormed`), f.namedNode(`${ns4}label`), f.literal("shapes graph well-formed", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}shapesGraphWellFormed`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}boolean`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sourceConstraint`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sourceConstraint`), f.namedNode(`${ns4}comment`), f.literal("The constraint that was validated when the result was produced.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sourceConstraint`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}AbstractResult`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sourceConstraint`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sourceConstraint`), f.namedNode(`${ns4}label`), f.literal("source constraint", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sourceConstraintComponent`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sourceConstraintComponent`), f.namedNode(`${ns4}comment`), f.literal("The constraint component that is the source of the result.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sourceConstraintComponent`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}AbstractResult`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sourceConstraintComponent`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sourceConstraintComponent`), f.namedNode(`${ns4}label`), f.literal("source constraint component", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sourceConstraintComponent`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sourceShape`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sourceShape`), f.namedNode(`${ns4}comment`), f.literal("The shape that is was validated when the result was produced.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sourceShape`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}AbstractResult`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sourceShape`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sourceShape`), f.namedNode(`${ns4}label`), f.literal("source shape", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sourceShape`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}Shape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sparql`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sparql`), f.namedNode(`${ns4}comment`), f.literal("Links a shape with SPARQL constraints.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sparql`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}Shape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sparql`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sparql`), f.namedNode(`${ns4}label`), f.literal("constraint (in SPARQL)", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sparql`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}SPARQLConstraint`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}subject`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}subject`), f.namedNode(`${ns4}comment`), f.literal("An expression producing the resources that shall be inferred as subjects.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}subject`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}TripleRule`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}subject`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}subject`), f.namedNode(`${ns4}label`), f.literal("subject", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}suggestedShapesGraph`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}suggestedShapesGraph`), f.namedNode(`${ns4}comment`), f.literal("Suggested shapes graphs for this ontology. The values of this property may be used in the absence of specific sh:shapesGraph statements.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}suggestedShapesGraph`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns3}Ontology`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}suggestedShapesGraph`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}suggestedShapesGraph`), f.namedNode(`${ns4}label`), f.literal("suggested shapes graph", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}suggestedShapesGraph`), f.namedNode(`${ns4}range`), f.namedNode(`${ns3}Ontology`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}sum`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}target`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}target`), f.namedNode(`${ns4}comment`), f.literal("Links a shape to a target specified by an extension language, for example instances of sh:SPARQLTarget.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}target`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}Shape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}target`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}target`), f.namedNode(`${ns4}label`), f.literal("target", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}target`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}Target`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetClass`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetClass`), f.namedNode(`${ns4}comment`), f.literal("Links a shape to a class, indicating that all instances of the class must conform to the shape.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetClass`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}Shape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetClass`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetClass`), f.namedNode(`${ns4}label`), f.literal("target class", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetClass`), f.namedNode(`${ns4}range`), f.namedNode(`${ns4}Class`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetNode`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetNode`), f.namedNode(`${ns4}comment`), f.literal("Links a shape to individual nodes, indicating that these nodes must conform to the shape.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetNode`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}Shape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetNode`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetNode`), f.namedNode(`${ns4}label`), f.literal("target node", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetObjectsOf`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetObjectsOf`), f.namedNode(`${ns4}comment`), f.literal("Links a shape to a property, indicating that all all objects of triples that have the given property as their predicate must conform to the shape.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetObjectsOf`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}Shape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetObjectsOf`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetObjectsOf`), f.namedNode(`${ns4}label`), f.literal("target objects of", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetObjectsOf`), f.namedNode(`${ns4}range`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns4}comment`), f.literal("Links a shape to a property, indicating that all subjects of triples that have the given property as their predicate must conform to the shape.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}Shape`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns4}label`), f.literal("target subjects of", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}targetSubjectsOf`), f.namedNode(`${ns4}range`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}then`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}this`), f.namedNode(`${ns2}type`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}this`), f.namedNode(`${ns4}comment`), f.literal("A node expression that represents the current focus node.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}this`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}this`), f.namedNode(`${ns4}label`), f.literal("this", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}union`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}union`), f.namedNode(`${ns4}comment`), f.literal("A list of node expressions that shall be used together.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}union`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}union`), f.namedNode(`${ns4}label`), f.literal("union", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}uniqueLang`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}uniqueLang`), f.namedNode(`${ns4}comment`), f.literal("Specifies whether all node values must have a unique (or no) language tag.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}uniqueLang`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}uniqueLang`), f.namedNode(`${ns4}label`), f.literal("unique languages", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}uniqueLang`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}boolean`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}update`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}update`), f.namedNode(`${ns4}comment`), f.literal("The SPARQL UPDATE to execute.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}update`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}SPARQLUpdateExecutable`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}update`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}update`), f.namedNode(`${ns4}label`), f.literal("update", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}update`), f.namedNode(`${ns4}range`), f.namedNode(`${ns6}string`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}validator`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}validator`), f.namedNode(`${ns4}comment`), f.literal("The validator(s) used to evaluate constraints of either node or property shapes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}validator`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}ConstraintComponent`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}validator`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}validator`), f.namedNode(`${ns4}label`), f.literal("validator", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}validator`), f.namedNode(`${ns4}range`), f.namedNode(`${ns1}Validator`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}value`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}value`), f.namedNode(`${ns4}comment`), f.literal("An RDF node that has caused the result.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}value`), f.namedNode(`${ns4}domain`), f.namedNode(`${ns1}AbstractResult`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}value`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}value`), f.namedNode(`${ns4}label`), f.literal("value", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}values`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}xone`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}xone`), f.namedNode(`${ns4}comment`), f.literal("Specifies a list of shapes so that the value nodes must conform to exactly one of the shapes.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}xone`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}xone`), f.namedNode(`${ns4}label`), f.literal("exactly one", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}xone`), f.namedNode(`${ns4}range`), f.namedNode(`${ns2}List`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}zeroOrMorePath`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}zeroOrMorePath`), f.namedNode(`${ns4}comment`), f.literal("The (single) value of this property represents a path that is matched zero or more times.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}zeroOrMorePath`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}zeroOrMorePath`), f.namedNode(`${ns4}label`), f.literal("zero or more path", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}zeroOrMorePath`), f.namedNode(`${ns4}range`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}zeroOrOnePath`), f.namedNode(`${ns2}type`), f.namedNode(`${ns2}Property`), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}zeroOrOnePath`), f.namedNode(`${ns4}comment`), f.literal("The (single) value of this property represents a path that is matched zero or one times.", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}zeroOrOnePath`), f.namedNode(`${ns4}isDefinedBy`), f.namedNode(ns1), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}zeroOrOnePath`), f.namedNode(`${ns4}label`), f.literal("zero or one path", "en"), f.namedNode(ns1)),
    f.quad(f.namedNode(`${ns1}zeroOrOnePath`), f.namedNode(`${ns4}range`), f.namedNode(`${ns4}Resource`), f.namedNode(ns1)),
    f.quad(blankNodes[4], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[4], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[4], f.namedNode(`${ns1}node`), f.namedNode(`${ns5}ShapeShape`), f.namedNode(ns1)),
    f.quad(blankNodes[4], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}filterShape`), f.namedNode(ns1)),
    f.quad(blankNodes[40], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}IfExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[40], f.namedNode(`${ns2}rest`), blankNodes[41], f.namedNode(ns1)),
    f.quad(blankNodes[16], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[16], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[16], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[16], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}nodes`), f.namedNode(ns1)),
    f.quad(blankNodes[32], f.namedNode(`${ns1}datatype`), f.namedNode(`${ns6}string`), f.namedNode(ns1)),
    f.quad(blankNodes[32], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[32], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[32], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}select`), f.namedNode(ns1)),
    f.quad(blankNodes[6], f.namedNode(`${ns1}datatype`), f.namedNode(`${ns6}string`), f.namedNode(ns1)),
    f.quad(blankNodes[6], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[6], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}separator`), f.namedNode(ns1)),
    f.quad(blankNodes[42], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}BlankNodeOrLiteral`), f.namedNode(ns1)),
    f.quad(blankNodes[42], f.namedNode(`${ns2}rest`), blankNodes[43], f.namedNode(ns1)),
    f.quad(blankNodes[19], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(blankNodes[19], f.namedNode(`${ns2}rest`), blankNodes[44], f.namedNode(ns1)),
    f.quad(blankNodes[45], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}MinExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[45], f.namedNode(`${ns2}rest`), blankNodes[46], f.namedNode(ns1)),
    f.quad(blankNodes[47], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}SPARQLAskExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[47], f.namedNode(`${ns2}rest`), blankNodes[48], f.namedNode(ns1)),
    f.quad(blankNodes[25], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[25], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[25], f.namedNode(`${ns1}node`), f.namedNode(`${ns5}PathShape`), f.namedNode(ns1)),
    f.quad(blankNodes[25], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}path`), f.namedNode(ns1)),
    f.quad(blankNodes[49], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}MinusExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[49], f.namedNode(`${ns2}rest`), blankNodes[50], f.namedNode(ns1)),
    f.quad(blankNodes[46], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}MaxExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[46], f.namedNode(`${ns2}rest`), blankNodes[51], f.namedNode(ns1)),
    f.quad(blankNodes[52], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}LimitExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[52], f.namedNode(`${ns2}rest`), blankNodes[53], f.namedNode(ns1)),
    f.quad(blankNodes[8], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[8], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[8], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}then`), f.namedNode(ns1)),
    f.quad(blankNodes[44], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}IRI`), f.namedNode(ns1)),
    f.quad(blankNodes[44], f.namedNode(`${ns2}rest`), blankNodes[54], f.namedNode(ns1)),
    f.quad(blankNodes[55], f.namedNode(`${ns1}zeroOrMorePath`), f.namedNode(`${ns2}rest`), f.namedNode(ns1)),
    f.quad(blankNodes[5], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[5], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[5], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}nodes`), f.namedNode(ns1)),
    f.quad(blankNodes[56], f.namedNode(`${ns2}first`), blankNodes[57], f.namedNode(ns1)),
    f.quad(blankNodes[56], f.namedNode(`${ns2}rest`), f.namedNode(`${ns2}nil`), f.namedNode(ns1)),
    f.quad(blankNodes[0], f.namedNode(`${ns1}namespace`), f.literal("http://www.w3.org/ns/shacl#"), f.namedNode(ns1)),
    f.quad(blankNodes[0], f.namedNode(`${ns1}prefix`), f.literal("sh"), f.namedNode(ns1)),
    f.quad(blankNodes[58], f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNode`), f.namedNode(ns1)),
    f.quad(blankNodes[58], f.namedNode(`${ns1}not`), blankNodes[59], f.namedNode(ns1)),
    f.quad(blankNodes[18], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}FocusNodeOrConstantTermExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[18], f.namedNode(`${ns2}rest`), blankNodes[60], f.namedNode(ns1)),
    f.quad(blankNodes[15], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[15], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[15], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[15], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}min`), f.namedNode(ns1)),
    f.quad(blankNodes[30], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[30], f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNodeOrIRI`), f.namedNode(ns1)),
    f.quad(blankNodes[30], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}prefixes`), f.namedNode(ns1)),
    f.quad(blankNodes[61], f.namedNode(`${ns2}first`), blankNodes[55], f.namedNode(ns1)),
    f.quad(blankNodes[61], f.namedNode(`${ns2}rest`), blankNodes[62], f.namedNode(ns1)),
    f.quad(blankNodes[1], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[1], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[1], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[1], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}count`), f.namedNode(ns1)),
    f.quad(blankNodes[12], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[12], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[12], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[12], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}nodes`), f.namedNode(ns1)),
    f.quad(blankNodes[33], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[33], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[33], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}nodes`), f.namedNode(ns1)),
    f.quad(blankNodes[63], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[63], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[63], f.namedNode(`${ns1}node`), f.namedNode(`${ns7}ListShape`), f.namedNode(ns1)),
    f.quad(blankNodes[63], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}intersection`), f.namedNode(ns1)),
    f.quad(blankNodes[63], f.namedNode(`${ns1}property`), blankNodes[64], f.namedNode(ns1)),
    f.quad(blankNodes[13], f.namedNode(`${ns1}datatype`), f.namedNode(`${ns6}integer`), f.namedNode(ns1)),
    f.quad(blankNodes[13], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[13], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[13], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}limit`), f.namedNode(ns1)),
    f.quad(blankNodes[59], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}ExistsExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[59], f.namedNode(`${ns2}rest`), blankNodes[40], f.namedNode(ns1)),
    f.quad(blankNodes[36], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[36], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[36], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[36], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}object`), f.namedNode(ns1)),
    f.quad(blankNodes[2], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[2], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[2], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[2], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}distinct`), f.namedNode(ns1)),
    f.quad(blankNodes[65], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}IntersectionExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[65], f.namedNode(`${ns2}rest`), blankNodes[66], f.namedNode(ns1)),
    f.quad(blankNodes[57], f.namedNode(`${ns1}xone`), blankNodes[59], f.namedNode(ns1)),
    f.quad(blankNodes[34], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[34], f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNodeOrIRI`), f.namedNode(ns1)),
    f.quad(blankNodes[34], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}prefixes`), f.namedNode(ns1)),
    f.quad(blankNodes[67], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}GroupConcatExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[67], f.namedNode(`${ns2}rest`), blankNodes[68], f.namedNode(ns1)),
    f.quad(blankNodes[20], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[20], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[20], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[20], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}nodes`), f.namedNode(ns1)),
    f.quad(blankNodes[69], f.namedNode(`${ns1}property`), blankNodes[63], f.namedNode(ns1)),
    f.quad(blankNodes[27], f.namedNode(`${ns1}datatype`), f.namedNode(`${ns6}string`), f.namedNode(ns1)),
    f.quad(blankNodes[27], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[27], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[27], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}ask`), f.namedNode(ns1)),
    f.quad(blankNodes[28], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[28], f.namedNode(`${ns1}nodeKind`), f.namedNode(`${ns1}BlankNodeOrIRI`), f.namedNode(ns1)),
    f.quad(blankNodes[28], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}prefixes`), f.namedNode(ns1)),
    f.quad(blankNodes[64], f.namedNode(`${ns1}minCount`), f.literal("2", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[64], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[64], f.namedNode(`${ns1}path`), blankNodes[61], f.namedNode(ns1)),
    f.quad(blankNodes[22], f.namedNode(`${ns1}datatype`), f.namedNode(`${ns6}boolean`), f.namedNode(ns1)),
    f.quad(blankNodes[22], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[22], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}desc`), f.namedNode(ns1)),
    f.quad(blankNodes[29], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[29], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[29], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}nodes`), f.namedNode(ns1)),
    f.quad(blankNodes[41], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}FilterShapeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[41], f.namedNode(`${ns2}rest`), blankNodes[70], f.namedNode(ns1)),
    f.quad(blankNodes[62], f.namedNode(`${ns2}first`), f.namedNode(`${ns2}first`), f.namedNode(ns1)),
    f.quad(blankNodes[62], f.namedNode(`${ns2}rest`), f.namedNode(`${ns2}nil`), f.namedNode(ns1)),
    f.quad(blankNodes[48], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}SPARQLSelectExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[48], f.namedNode(`${ns2}rest`), f.namedNode(`${ns2}nil`), f.namedNode(ns1)),
    f.quad(blankNodes[26], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[26], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[26], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}nodes`), f.namedNode(ns1)),
    f.quad(blankNodes[71], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}CountExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[71], f.namedNode(`${ns2}rest`), blankNodes[45], f.namedNode(ns1)),
    f.quad(blankNodes[7], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[7], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[7], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[7], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}groupConcat`), f.namedNode(ns1)),
    f.quad(blankNodes[54], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}Literal`), f.namedNode(ns1)),
    f.quad(blankNodes[54], f.namedNode(`${ns2}rest`), blankNodes[72], f.namedNode(ns1)),
    f.quad(blankNodes[23], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[23], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[23], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[23], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}nodes`), f.namedNode(ns1)),
    f.quad(blankNodes[21], f.namedNode(`${ns1}datatype`), f.namedNode(`${ns6}integer`), f.namedNode(ns1)),
    f.quad(blankNodes[21], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[21], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[21], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}offset`), f.namedNode(ns1)),
    f.quad(blankNodes[50], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}DistinctExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[50], f.namedNode(`${ns2}rest`), blankNodes[71], f.namedNode(ns1)),
    f.quad(blankNodes[14], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[14], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[14], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[14], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}max`), f.namedNode(ns1)),
    f.quad(blankNodes[51], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}SumExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[51], f.namedNode(`${ns2}rest`), blankNodes[67], f.namedNode(ns1)),
    f.quad(blankNodes[68], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}OrderByExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[68], f.namedNode(`${ns2}rest`), blankNodes[52], f.namedNode(ns1)),
    f.quad(blankNodes[60], f.namedNode(`${ns2}first`), blankNodes[58], f.namedNode(ns1)),
    f.quad(blankNodes[60], f.namedNode(`${ns2}rest`), blankNodes[56], f.namedNode(ns1)),
    f.quad(blankNodes[24], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[24], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[24], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[24], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}orderBy`), f.namedNode(ns1)),
    f.quad(blankNodes[35], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[35], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[35], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[35], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}sum`), f.namedNode(ns1)),
    f.quad(blankNodes[3], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[3], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[3], f.namedNode(`${ns1}node`), f.namedNode(`${ns5}ShapeShape`), f.namedNode(ns1)),
    f.quad(blankNodes[3], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}exists`), f.namedNode(ns1)),
    f.quad(blankNodes[37], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[37], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[37], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[37], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}subject`), f.namedNode(ns1)),
    f.quad(blankNodes[11], f.namedNode(`${ns1}and`), blankNodes[73], f.namedNode(ns1)),
    f.quad(blankNodes[11], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[11], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[11], f.namedNode(`${ns1}node`), f.namedNode(`${ns7}ListShape`), f.namedNode(ns1)),
    f.quad(blankNodes[11], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}intersection`), f.namedNode(ns1)),
    f.quad(blankNodes[9], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[9], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[9], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[9], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}if`), f.namedNode(ns1)),
    f.quad(blankNodes[53], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}OffsetExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[53], f.namedNode(`${ns2}rest`), blankNodes[47], f.namedNode(ns1)),
    f.quad(blankNodes[72], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}BlankNodeOrIRI`), f.namedNode(ns1)),
    f.quad(blankNodes[72], f.namedNode(`${ns2}rest`), blankNodes[42], f.namedNode(ns1)),
    f.quad(blankNodes[70], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}PathExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[70], f.namedNode(`${ns2}rest`), blankNodes[65], f.namedNode(ns1)),
    f.quad(blankNodes[38], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[38], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[38], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[38], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}predicate`), f.namedNode(ns1)),
    f.quad(blankNodes[39], f.namedNode(`${ns1}and`), blankNodes[74], f.namedNode(ns1)),
    f.quad(blankNodes[39], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[39], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[39], f.namedNode(`${ns1}node`), f.namedNode(`${ns7}ListShape`), f.namedNode(ns1)),
    f.quad(blankNodes[39], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}union`), f.namedNode(ns1)),
    f.quad(blankNodes[66], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}UnionExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[66], f.namedNode(`${ns2}rest`), blankNodes[49], f.namedNode(ns1)),
    f.quad(blankNodes[10], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[10], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[10], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}else`), f.namedNode(ns1)),
    f.quad(blankNodes[17], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[17], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[17], f.namedNode(`${ns1}node`), f.namedNode(`${ns1}NodeExpression`), f.namedNode(ns1)),
    f.quad(blankNodes[17], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}minus`), f.namedNode(ns1)),
    f.quad(blankNodes[74], f.namedNode(`${ns2}first`), blankNodes[75], f.namedNode(ns1)),
    f.quad(blankNodes[74], f.namedNode(`${ns2}rest`), f.namedNode(`${ns2}nil`), f.namedNode(ns1)),
    f.quad(blankNodes[73], f.namedNode(`${ns2}first`), blankNodes[75], f.namedNode(ns1)),
    f.quad(blankNodes[73], f.namedNode(`${ns2}rest`), f.namedNode(`${ns2}nil`), f.namedNode(ns1)),
    f.quad(blankNodes[31], f.namedNode(`${ns1}datatype`), f.namedNode(`${ns6}string`), f.namedNode(ns1)),
    f.quad(blankNodes[31], f.namedNode(`${ns1}maxCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[31], f.namedNode(`${ns1}minCount`), f.literal("1", f.namedNode(`${ns6}integer`)), f.namedNode(ns1)),
    f.quad(blankNodes[31], f.namedNode(`${ns1}path`), f.namedNode(`${ns1}construct`), f.namedNode(ns1)),
    f.quad(blankNodes[43], f.namedNode(`${ns2}first`), f.namedNode(`${ns1}IRIOrLiteral`), f.namedNode(ns1)),
    f.quad(blankNodes[43], f.namedNode(`${ns2}rest`), f.namedNode(`${ns2}nil`), f.namedNode(ns1))
  ];
};

// node_modules/rdf-validate-shacl/src/node-set.js
var NodeSet = class extends TermSet_default {
  addAll(nodes) {
    for (const node of nodes) {
      this.add(node);
    }
  }
};
var node_set_default = NodeSet;

// node_modules/rdf-validate-shacl/src/property-path.js
function extractPropertyPath(pathNode, ns2, allowNamedNodeInList) {
  if (pathNode.term.termType === "NamedNode" && !allowNamedNodeInList) {
    return pathNode.term;
  }
  if (pathNode.term.termType === "BlankNode" || pathNode.term.termType === "NamedNode") {
    const first3 = pathNode.out(ns2.rdf.first).term;
    if (first3) {
      const paths = [...pathNode.list()];
      return paths.map((path) => extractPropertyPath(path, ns2, allowNamedNodeInList));
    }
    const alternativePath = pathNode.out(ns2.sh.alternativePath);
    if (alternativePath.term) {
      const paths = [...alternativePath.list()];
      return { or: paths.map((path) => extractPropertyPath(path, ns2, allowNamedNodeInList)) };
    }
    const zeroOrMorePath = pathNode.out(ns2.sh.zeroOrMorePath);
    if (zeroOrMorePath.term) {
      return { zeroOrMore: extractPropertyPath(zeroOrMorePath, ns2, allowNamedNodeInList) };
    }
    const oneOrMorePath = pathNode.out(ns2.sh.oneOrMorePath);
    if (oneOrMorePath.term) {
      return { oneOrMore: extractPropertyPath(oneOrMorePath, ns2, allowNamedNodeInList) };
    }
    const zeroOrOnePath = pathNode.out(ns2.sh.zeroOrOnePath);
    if (zeroOrOnePath.term) {
      return { zeroOrOne: extractPropertyPath(zeroOrOnePath, ns2, allowNamedNodeInList) };
    }
    const inversePath = pathNode.out(ns2.sh.inversePath);
    if (inversePath.term) {
      return { inverse: extractPropertyPath(inversePath, ns2, allowNamedNodeInList) };
    }
    return pathNode.term;
  }
  throw new Error(`Unsupported SHACL path: ${pathNode.term.value}`);
}
function getPathObjects(graph, subject, path) {
  return [...getPathObjectsSet(graph, subject, path)];
}
function getPathObjectsSet(graph, subject, path) {
  if ("termType" in path && path.termType === "NamedNode") {
    return getNamedNodePathObjects(graph, subject, path);
  } else if (Array.isArray(path)) {
    return getSequencePathObjects(graph, subject, path);
  } else if ("or" in path) {
    return getOrPathObjects(graph, subject, path);
  } else if ("inverse" in path) {
    return getInversePathObjects(graph, subject, path);
  } else if ("zeroOrOne" in path) {
    return getZeroOrOnePathObjects(graph, subject, path);
  } else if ("zeroOrMore" in path) {
    return getZeroOrMorePathObjects(graph, subject, path);
  } else if ("oneOrMore" in path) {
    return getOneOrMorePathObjects(graph, subject, path);
  } else {
    throw new Error(`Unsupported path object: ${path}`);
  }
}
function getNamedNodePathObjects(graph, subject, path) {
  return new node_set_default(graph.node(subject).out(path).terms);
}
function getSequencePathObjects(graph, subject, path) {
  let subjects = new node_set_default([subject]);
  for (const pathItem of path) {
    subjects = new node_set_default(flatMap(subjects, (subjectItem) => getPathObjects(graph, subjectItem, pathItem)));
  }
  return subjects;
}
function getOrPathObjects(graph, subject, path) {
  return new node_set_default(flatMap(path.or, (pathItem) => getPathObjects(graph, subject, pathItem)));
}
function getInversePathObjects(graph, subject, path) {
  if (!("termType" in path.inverse) || path.inverse.termType !== "NamedNode") {
    throw new Error("Unsupported: Inverse paths only work for named nodes");
  }
  return new node_set_default(graph.node(subject).in(path.inverse).terms);
}
function getZeroOrOnePathObjects(graph, subject, path) {
  const pathObjects = getPathObjectsSet(graph, subject, path.zeroOrOne);
  pathObjects.add(subject);
  return pathObjects;
}
function getZeroOrMorePathObjects(graph, subject, path) {
  const pathObjects = walkPath(graph, subject, path.zeroOrMore);
  pathObjects.add(subject);
  return pathObjects;
}
function getOneOrMorePathObjects(graph, subject, path) {
  return walkPath(graph, subject, path.oneOrMore);
}
function walkPath(graph, subject, path, visited = new node_set_default()) {
  visited.add(subject);
  const pathValues = getPathObjectsSet(graph, subject, path);
  const deeperValues = flatMap(pathValues, (pathValue) => {
    if (!visited.has(pathValue)) {
      return [...walkPath(graph, pathValue, path, visited)];
    } else {
      return [];
    }
  });
  pathValues.addAll(deeperValues);
  return pathValues;
}
function flatMap(arr, func) {
  return [...arr].reduce((acc, x) => acc.concat(func(x)), []);
}

// node_modules/rdf-validate-shacl/src/dataset-utils.js
function* extractStructure(dataset2, startNode, visited = new TermSet_default()) {
  if (startNode.termType !== "BlankNode" || visited.has(startNode)) {
    return;
  }
  visited.add(startNode);
  for (const quad3 of dataset2.match(startNode, null, null)) {
    yield quad3;
    yield* extractStructure(dataset2, quad3.object, visited);
  }
}
function* extractSourceShapeStructure(shape, dataset2, startNode, visited = new TermSet_default()) {
  if (startNode.termType !== "BlankNode" || visited.has(startNode)) {
    return;
  }
  const { factory: factory3 } = shape.context;
  const { sh, rdfs: rdfs2 } = shape.context.ns;
  const inListSize = (term2) => {
    const inConstraint = shape.constraints.find((x) => term2.equals(x.paramValue));
    return inConstraint?.nodeSet.size || -1;
  };
  visited.add(startNode);
  for (const quad3 of dataset2.match(startNode, null, null)) {
    if (quad3.predicate.equals(sh.in) && inListSize(quad3.object) > 3) {
      const msg = `sh:in has ${inListSize(quad3.object)} elements and has been removed from the report for brevity. Please refer the original shape`;
      yield factory3.quad(quad3.subject, rdfs2.comment, factory3.literal(msg));
    } else {
      yield quad3;
      yield* extractSourceShapeStructure(shape, dataset2, quad3.object, visited);
    }
  }
}
function getInstancesOf(cls, ns2) {
  const classes = getSubClassesOf(cls, ns2);
  classes.add(cls.term);
  return [...classes].reduce((acc, classTerm) => {
    const classInstances = cls.node(classTerm).in(ns2.rdf.type).terms;
    acc.addAll(classInstances);
    return acc;
  }, new node_set_default());
}
function getSubClassesOf(cls, ns2) {
  const subclasses = cls.in(ns2.rdfs.subClassOf);
  const transubclasses = subclasses.toArray().reduce((acc, subclass) => {
    const scs = getSubClassesOf(subclass, ns2);
    acc.addAll(scs);
    return acc;
  }, new node_set_default());
  return new node_set_default([...subclasses.terms, ...transubclasses]);
}
function isInstanceOf(instance, cls, ns2) {
  const classes = getSubClassesOf(cls, ns2);
  classes.add(cls.term);
  const types = instance.out(ns2.rdf.type).terms;
  return types.some((type) => classes.has(type));
}
function rdfListToArray(listNode) {
  return [...listNode.list?.() || []].map(({ term: term2 }) => term2);
}

// node_modules/rdf-validate-shacl/src/shapes-graph.js
var ShapesGraph = class {
  _components;
  _parametersMap;
  _shapes;
  _shapeNodesWithConstraints;
  _shapesWithTarget;
  constructor(context2) {
    this.context = context2;
    const { sh } = context2.ns;
    const shaclVocabulary = context2.factory.clownface({
      dataset: context2.factory.dataset(sh_default(context2))
    });
    const componentNodes = getInstancesOf(shaclVocabulary.node(sh.ConstraintComponent), context2.ns);
    this._components = [...componentNodes].map((node) => new ConstraintComponent(node, context2, shaclVocabulary));
    this._parametersMap = /* @__PURE__ */ new Map();
    for (const component of this._components) {
      for (const parameter of component.parameters) {
        this._parametersMap.set(parameter.value, component);
      }
    }
    this._shapes = /* @__PURE__ */ new Map();
  }
  getComponentWithParameter(parameter) {
    return this._parametersMap.get(parameter.value);
  }
  getShape(shapeNode) {
    if (!this._shapes.has(shapeNode.value)) {
      const shape = new Shape(this.context, shapeNode);
      this._shapes.set(shapeNode.value, shape);
    }
    return this._shapes.get(shapeNode.value);
  }
  get shapeNodesWithConstraints() {
    if (!this._shapeNodesWithConstraints) {
      const set = new node_set_default();
      for (const component of this._components) {
        const params = component.requiredParameters;
        for (const param of params) {
          const shapesWithParam = [...this.context.$shapes.dataset.match(null, param, null)].map(({ subject }) => subject);
          set.addAll(shapesWithParam);
        }
      }
      this._shapeNodesWithConstraints = [...set];
    }
    return this._shapeNodesWithConstraints;
  }
  get shapesWithTarget() {
    const { $shapes, ns: ns2 } = this.context;
    const { rdfs: rdfs2, sh } = ns2;
    if (!this._shapesWithTarget) {
      this._shapesWithTarget = this.shapeNodesWithConstraints.filter((shapeNode) => isInstanceOf($shapes.node(shapeNode), $shapes.node(rdfs2.Class), ns2) || $shapes.node(shapeNode).out([
        sh.targetClass,
        sh.targetNode,
        sh.targetSubjectsOf,
        sh.targetObjectsOf,
        sh.target
      ]).terms.length > 0).map((shapeNode) => this.getShape(shapeNode));
    }
    return this._shapesWithTarget;
  }
};
var Constraint = class _Constraint {
  shape;
  component;
  paramValue;
  _parameterValues;
  inNodeSet;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(shape, component, shapesGraph, _parameterValuesOrSingleParam) {
    this.shape = shape;
    this.component = component;
    this.shapeNodePointer = shapesGraph.node(shape.shapeNode);
    if ("termType" in _parameterValuesOrSingleParam) {
      this.paramValue = _parameterValuesOrSingleParam;
    } else {
      this._parameterValues = _parameterValuesOrSingleParam;
    }
  }
  get validate() {
    if (this.component.validator && this.validationFunction) {
      return (focusNode, valueNode) => {
        return this.validationFunction(focusNode, valueNode, this);
      };
    }
  }
  static *fromShape(shape, component, shapesGraph) {
    const allParams = component.parameters.map((param) => {
      return [param, shape.shapeNodePointer.out(param).terms];
    });
    const combinations = allParams.reduce((acc, [param, values2]) => {
      if (values2.length === 0) {
        return acc;
      }
      if (acc.length === 0) {
        return values2.map((value) => [[param, value]]);
      }
      return acc.flatMap((comb) => values2.map((value) => comb.concat([[param, value]])));
    }, []);
    for (const combination of combinations) {
      if (component.parameters.length === 1) {
        yield new _Constraint(shape, component, shapesGraph, combination[0][1]);
        continue;
      }
      const params = shape.context.factory.termMap(combination);
      if (component.isComplete(params)) {
        yield new _Constraint(shape, component, shapesGraph, params);
      }
    }
  }
  getParameterValue(param) {
    return this.paramValue || this._parameterValues.get(param);
  }
  get pathObject() {
    return this.shape.pathObject;
  }
  get validationFunction() {
    return this.shape.isPropertyShape ? this.component.propertyValidationFunction : this.component.nodeValidationFunction;
  }
  get isValidationFunctionGeneric() {
    return this.shape.isPropertyShape ? this.component.propertyValidationFunctionGeneric : this.component.nodeValidationFunctionGeneric;
  }
  get componentMessages() {
    return this.component.getMessages(this.shape);
  }
  get nodeSet() {
    const { sh } = this.shape.context.ns;
    if (!this.inNodeSet) {
      this.inNodeSet = new node_set_default(rdfListToArray(this.shapeNodePointer.out(sh.in)));
    }
    return this.inNodeSet;
  }
};
var ConstraintComponent = class {
  node;
  context;
  constructor(node, context2, shaclVocabulary) {
    this.node = node;
    this.context = context2;
    const { factory: factory3, ns: ns2 } = context2;
    const { sh, xsd: xsd4 } = ns2;
    this.nodePointer = shaclVocabulary.node(node);
    this.parameters = [];
    this.parameterNodes = [];
    this.requiredParameters = [];
    this.optionals = {};
    const trueTerm = factory3.literal("true", xsd4.boolean);
    this.nodePointer.out(sh.parameter).forEach((parameterCf) => {
      const parameter = parameterCf.term;
      parameterCf.out(sh.path).forEach(({ term: path }) => {
        this.parameters.push(path);
        this.parameterNodes.push(parameter);
        if (shaclVocabulary.dataset.match(parameter, sh.optional, trueTerm).size > 0) {
          this.optionals[path.value] = true;
        } else {
          this.requiredParameters.push(path);
        }
      });
    });
    this.validator = context2.validators.get(node);
    if (!this.validator) {
      return;
    }
    if ("nodeValidate" in this.validator) {
      this.nodeValidationFunction = this.validator.nodeValidate.bind(void 0, this.context);
      this.nodeValidationMessage = this.validator.nodeValidationMessage;
    } else if ("validate" in this.validator) {
      this.nodeValidationFunction = this.validator.validate.bind(void 0, this.context);
      this.nodeValidationMessage = this.validator.validationMessage;
      this.nodeValidationFunctionGeneric = true;
    }
    if ("propertyValidate" in this.validator) {
      this.propertyValidationFunction = this.validator.propertyValidate.bind(void 0, this.context);
      this.propertyValidationMessage = this.validator.propertyValidationMessage;
    } else if ("validate" in this.validator) {
      this.propertyValidationFunction = this.validator.validate.bind(void 0, this.context);
      this.propertyValidationMessage = this.validator.validationMessage;
      this.propertyValidationFunctionGeneric = true;
    }
  }
  getMessages(shape) {
    const message = shape.isPropertyShape ? this.propertyValidationMessage : this.nodeValidationMessage;
    return message ? [message] : [];
  }
  isComplete(parameterValues) {
    return this.requiredParameters.every((param) => parameterValues.has(param));
  }
};
var Shape = class _Shape {
  constructor(context2, shapeNode) {
    const { $shapes, ns: ns2, shapesGraph, allowNamedNodeInList: allowNamedNodeSequencePaths } = context2;
    const { sh } = ns2;
    this.context = context2;
    this.shapeNode = shapeNode;
    this.shapeNodePointer = $shapes.node(shapeNode);
    this.severity = this.shapeNodePointer.out(sh.severity).term || sh.Violation;
    this.deactivated = this.shapeNodePointer.out(sh.deactivated).value === "true";
    this.pathObject = null;
    const path = this.shapeNodePointer.out(sh.path);
    if (path.term) {
      this.path = path;
      this.pathObject = extractPropertyPath(this.path, ns2, allowNamedNodeSequencePaths);
    }
    this.constraints = [];
    const handled = new node_set_default();
    const shapeProperties = [...$shapes.dataset.match(shapeNode, null, null)];
    shapeProperties.forEach((sol) => {
      const component = shapesGraph.getComponentWithParameter(sol.predicate);
      if (component && !handled.has(component.node)) {
        this.constraints.push(...Constraint.fromShape(this, component, $shapes));
        handled.add(component.node);
      }
    });
  }
  get isPropertyShape() {
    return this.pathObject != null;
  }
  overridePath(path) {
    const shape = new _Shape(this.context, this.shapeNode);
    shape.pathObject = path;
    return shape;
  }
  getTargetNodes(dataGraph) {
    const { $shapes, ns: ns2 } = this.context;
    const { rdfs: rdfs2, sh } = ns2;
    const results = new node_set_default();
    if (isInstanceOf($shapes.node(this.shapeNode), $shapes.node(rdfs2.Class), ns2)) {
      results.addAll(getInstancesOf(dataGraph.node(this.shapeNode), ns2));
    }
    const targetClasses = [...$shapes.dataset.match(this.shapeNode, sh.targetClass, null)];
    targetClasses.forEach(({ object: targetClass }) => {
      results.addAll(getInstancesOf(dataGraph.node(targetClass), ns2));
    });
    results.addAll(this.shapeNodePointer.out(sh.targetNode).terms);
    this.shapeNodePointer.out(sh.targetSubjectsOf).terms.forEach((predicate) => {
      const subjects = [...dataGraph.dataset.match(null, predicate, null)].map(({ subject }) => subject);
      results.addAll(subjects);
    });
    this.shapeNodePointer.out(sh.targetObjectsOf).terms.forEach((predicate) => {
      const objects4 = [...dataGraph.dataset.match(null, predicate, null)].map(({ object }) => object);
      results.addAll(objects4);
    });
    return [...results];
  }
  getValueNodes(focusNode, dataGraph) {
    if (this.pathObject) {
      return getPathObjects(dataGraph, focusNode, this.pathObject);
    } else {
      return [focusNode];
    }
  }
};
var shapes_graph_default = ShapesGraph;

// node_modules/rdf-validate-shacl/src/validation-engine.js
var import_debug = __toESM(require_browser4(), 1);

// node_modules/rdf-validate-shacl/src/validation-report.js
var ValidationReport = class {
  constructor(pointer, options = {}) {
    this.factory = options.factory || defaultEnv_default;
    this.ns = options.ns || prepareNamespaces(this.factory);
    const { sh, xsd: xsd4 } = this.ns;
    this.pointer = pointer;
    this.term = pointer.term;
    this.dataset = pointer.dataset;
    const resultsPointer = pointer.out(sh.result);
    const conforms = resultsPointer.terms.length === 0;
    pointer.addOut(sh.conforms, this.factory.literal(conforms.toString(), xsd4.boolean));
    this.conforms = conforms;
    this.results = resultsPointer.toArray().map((resultPointer) => new ValidationResult(resultPointer, this.ns));
  }
};
var ValidationResult = class _ValidationResult {
  pointer;
  ns;
  constructor(pointer, ns2) {
    this.pointer = pointer;
    this.ns = ns2;
    this.term = pointer.term;
    this.dataset = pointer.dataset;
  }
  get message() {
    return this.pointer.out(this.ns.sh.resultMessage).terms || [];
  }
  get path() {
    return this.pointer.out(this.ns.sh.resultPath).term || null;
  }
  get focusNode() {
    return this.pointer.out(this.ns.sh.focusNode).term || null;
  }
  get severity() {
    return this.pointer.out(this.ns.sh.resultSeverity).term || null;
  }
  get sourceConstraintComponent() {
    return this.pointer.out(this.ns.sh.sourceConstraintComponent).term || null;
  }
  get sourceShape() {
    return this.pointer.out(this.ns.sh.sourceShape).term || null;
  }
  get value() {
    return this.pointer.out(this.ns.sh.value).term || null;
  }
  get detail() {
    return this.pointer.out(this.ns.sh.detail).map((detailResult) => new _ValidationResult(detailResult, this.ns));
  }
};
var validation_report_default = ValidationReport;

// node_modules/rdf-validate-shacl/src/validation-engine.js
var error = (0, import_debug.default)("validation-engine::error");
var defaultMaxNodeChecks = 50;
var ValidationEngine = class _ValidationEngine {
  constructor(context2, options) {
    this.context = context2;
    this.factory = context2.factory;
    this.maxErrors = options.maxErrors;
    this.maxNodeChecks = options.maxNodeChecks === void 0 ? defaultMaxNodeChecks : options.maxNodeChecks;
    this.initReport();
    this.recordErrorsLevel = options.recordErrorsLevel || 0;
    this.violationsCount = 0;
    this.validationError = null;
    this.nestedResults = options.nestedResults || {};
    this.nodeCheckCounters = {};
    this.reportPointer = this.factory.clownface().blankNode();
  }
  clone({ recordErrorsLevel } = {}) {
    return new _ValidationEngine(this.context, {
      maxErrors: this.maxErrors,
      maxNodeChecks: this.maxNodeChecks,
      recordErrorsLevel
    });
  }
  initReport() {
    const { rdf: rdf2, sh } = this.context.ns;
    this.nodeCheckCounters = {};
    this.reportPointer = this.factory.clownface({
      term: this.factory.blankNode("report")
    }).addOut(rdf2.type, sh.ValidationReport);
  }
  /**
   * Validates the data graph against the shapes graph
   */
  validateAll(dataGraph) {
    if (this.maxErrorsReached())
      return true;
    this.validationError = null;
    try {
      this.initReport();
      let foundError = false;
      const shapes = this.context.shapesGraph.shapesWithTarget;
      for (const shape of shapes) {
        const focusNodes = shape.getTargetNodes(dataGraph);
        for (const focusNode of focusNodes) {
          if (this.validateNodeAgainstShape(focusNode, shape, dataGraph)) {
            foundError = true;
          }
        }
      }
      return foundError;
    } catch (e) {
      this.validationError = e;
      return true;
    }
  }
  /**
   * Returns true if any violation has been found
   */
  validateNodeAgainstShape(focusNode, shape, dataGraph) {
    if (this.maxErrorsReached())
      return true;
    if (shape.deactivated)
      return false;
    if (this.maxNodeChecks > 0) {
      const id = JSON.stringify([focusNode, shape.shapeNode]);
      const nodeCheckCounter = this.nodeCheckCounters[id] === void 0 ? 0 : this.nodeCheckCounters[id];
      if (nodeCheckCounter > this.maxNodeChecks) {
        return false;
      }
      this.nodeCheckCounters[id] = nodeCheckCounter + 1;
    }
    const valueNodes = shape.getValueNodes(focusNode, dataGraph);
    let errorFound = false;
    for (const constraint of shape.constraints) {
      if (this.validateNodeAgainstConstraint(focusNode, valueNodes, constraint, dataGraph)) {
        errorFound = true;
      }
    }
    return errorFound;
  }
  validateNodeAgainstConstraint(focusNode, valueNodes, constraint, dataGraph) {
    const { sh } = this.context.ns;
    if (this.maxErrorsReached())
      return true;
    if (sh.PropertyConstraintComponent.equals(constraint.component.node)) {
      let errorFound = false;
      for (const valueNode of valueNodes) {
        if (this.validateNodeAgainstShape(valueNode, this.context.shapesGraph.getShape(constraint.paramValue), dataGraph)) {
          errorFound = true;
        }
      }
      return errorFound;
    }
    if (!constraint.validate) {
      throw new Error("Cannot find validator for constraint component " + constraint.component.node.value);
    }
    if (constraint.isValidationFunctionGeneric) {
      let errorFound = false;
      for (const valueNode of valueNodes) {
        if (this.maxErrorsReached()) {
          break;
        }
        const valueNodeError = this.validateValueNodeAgainstConstraint(focusNode, valueNode, constraint);
        if (valueNodeError) {
          this.violationsCount++;
        }
        errorFound = errorFound || valueNodeError;
      }
      return errorFound;
    } else {
      return this.validateValueNodeAgainstConstraint(focusNode, null, constraint);
    }
  }
  validateValueNodeAgainstConstraint(focusNode, valueNode, constraint) {
    const { sh } = this.context.ns;
    this.recordErrorsLevel++;
    const validationOutput = constraint.validate(focusNode, valueNode);
    const validationResults = Array.isArray(validationOutput) ? validationOutput : [validationOutput];
    const results = validationResults.map((validationResult) => this.createResultFromObject(validationResult, constraint, focusNode, valueNode)).filter(Boolean);
    if (this.recordErrorsLevel === 1) {
      for (const result of results) {
        copyResult(result, this.reportPointer, sh.result);
      }
    } else {
      this.nestedResults[this.recordErrorsLevel] = (this.nestedResults[this.recordErrorsLevel] || []).concat(results);
    }
    this.recordErrorsLevel--;
    return results.length > 0;
  }
  maxErrorsReached() {
    if (this.maxErrors) {
      return this.violationsCount >= this.maxErrors;
    } else {
      return false;
    }
  }
  getReport() {
    if (this.validationError) {
      error("Validation Failure: " + this.validationError);
      throw this.validationError;
    } else {
      return new validation_report_default(this.reportPointer, { factory: this.factory, ns: this.context.ns });
    }
  }
  /**
   * Creates all the validation result nodes and messages for the result of applying the validation logic
   * of a constraints against a node.
   * Result passed as the first argument can be false, a resultMessage or a validation result object.
   * If none of these values is passed no error result or error message will be created.
   */
  createResultFromObject(validationResult, constraint, focusNode, valueNode) {
    const { sh } = this.context.ns;
    const validationResultObj = this.normalizeValidationResult(validationResult, valueNode);
    if (!validationResultObj) {
      return null;
    }
    const result = this.createResult(constraint, focusNode);
    if (validationResultObj.path) {
      result.addOut(sh.resultPath, validationResultObj.path);
      this.copyNestedStructure(validationResultObj.path, result);
    } else if (constraint.shape.isPropertyShape && constraint.shape.path?.term) {
      result.addOut(sh.resultPath, constraint.shape.path);
      this.copyNestedStructure(constraint.shape.path.term, result);
    }
    if (validationResultObj.value) {
      result.addOut(sh.value, validationResultObj.value);
      this.copyNestedStructure(validationResultObj.value, result);
    } else if (valueNode) {
      result.addOut(sh.value, valueNode);
      this.copyNestedStructure(valueNode, result);
    }
    const messages = this.createResultMessages(validationResultObj, constraint);
    for (const message of messages) {
      result.addOut(sh.resultMessage, message);
    }
    return result;
  }
  /**
   * Validators can return a boolean, a string (message) or a validation result object.
   * This function normalizes all of them as a validation result object.
   * @returns null if validation was successful.
   */
  normalizeValidationResult(validationResult, valueNode) {
    if (validationResult === false) {
      return { value: valueNode };
    } else if (typeof validationResult === "string") {
      return { message: validationResult, value: valueNode };
    } else if (typeof validationResult === "object") {
      return validationResult;
    } else {
      return null;
    }
  }
  /**
   * Creates a new BlankNode holding the SHACL validation result, adding the default
   * properties for the constraint, focused node and value node
   */
  createResult(constraint, focusNode) {
    const { rdf: rdf2, sh } = this.context.ns;
    const severity = constraint.shape.severity;
    const sourceConstraintComponent = constraint.component.node;
    const sourceShape = constraint.shape.shapeNode;
    const result = this.factory.clownface().blankNode();
    result.addOut(rdf2.type, sh.ValidationResult).addOut(sh.resultSeverity, severity).addOut(sh.sourceConstraintComponent, sourceConstraintComponent).addOut(sh.sourceShape, sourceShape).addOut(sh.focusNode, focusNode);
    this.copySourceShapeStructure(constraint.shape, result);
    this.copyNestedStructure(focusNode, result);
    const children = this.nestedResults[this.recordErrorsLevel + 1];
    if (children) {
      if (sourceConstraintComponent.equals(sh.NodeConstraintComponent)) {
        for (const child of children) {
          copyResult(child, result, sh.detail);
        }
      } else {
      }
      this.nestedResults[this.recordErrorsLevel + 1] = [];
    }
    return result;
  }
  copyNestedStructure(subject, result) {
    const structureQuads = extractStructure(this.context.$shapes.dataset, subject);
    for (const quad3 of structureQuads) {
      result.dataset.add(quad3);
    }
  }
  copySourceShapeStructure(shape, result) {
    const structureQuads = extractSourceShapeStructure(shape, this.context.$shapes.dataset, shape.shapeNode);
    for (const quad3 of structureQuads) {
      result.dataset.add(quad3);
    }
  }
  /**
   * Creates a result message from the validation result and the message pattern in the constraint
   */
  createResultMessages(validationResult, constraint) {
    const { $shapes, ns: ns2 } = this.context;
    const { sh } = ns2;
    let messages = [];
    if (validationResult.message) {
      messages = [this.factory.literal(validationResult.message)];
    }
    if (messages.length === 0) {
      messages = $shapes.node(constraint.shape.shapeNode).out(sh.message).terms;
    }
    if (messages.length === 0) {
      messages = constraint.componentMessages.map((m) => this.factory.literal(m));
    }
    if (messages.length === 0) {
      messages = $shapes.node(constraint.component.node).out(sh.message).terms;
    }
    return messages.map((message) => withSubstitutions(message, constraint, this.factory));
  }
};
function localName(uri) {
  let index = uri.lastIndexOf("#");
  if (index < 0) {
    index = uri.lastIndexOf("/");
  }
  if (index < 0) {
    throw new Error(`Cannot get local name of ${uri}`);
  }
  return uri.substring(index + 1);
}
function* take(n2, iterable) {
  let i2 = 0;
  for (const item of iterable) {
    if (i2++ === n2)
      break;
    yield item;
  }
}
function nodeLabel(constraint, param) {
  const node = constraint.getParameterValue(param);
  if (!node) {
    return "NULL";
  }
  if (node.termType === "NamedNode") {
    return "<" + node.value + ">";
  }
  if (node.termType === "BlankNode") {
    if (constraint.nodeSet) {
      const limit = 3;
      if (constraint.nodeSet.size > limit) {
        const prefix = Array.from(take(limit, constraint.nodeSet)).map((x) => x.value);
        return prefix.join(", ") + ` ... (and ${constraint.nodeSet.size - limit} more)`;
      } else {
        return Array.from(constraint.nodeSet).map((x) => x.value).join(", ");
      }
    }
    return "Blank node " + node.value;
  }
  return node.value;
}
function withSubstitutions(messageTerm, constraint, factory3) {
  const message = constraint.component.parameters.reduce((message2, param) => {
    const paramName = localName(param.value);
    const paramValue = nodeLabel(constraint, param);
    return message2.replace(`{$${paramName}}`, paramValue).replace(`{?${paramName}}`, paramValue);
  }, messageTerm.value);
  return factory3.literal(message, messageTerm.language || messageTerm.datatype);
}
function copyResult(resultPointer, targetPointer, predicate) {
  for (const quad3 of resultPointer.dataset) {
    targetPointer.dataset.add(quad3);
  }
  targetPointer.addOut(predicate, resultPointer);
}
var validation_engine_default = ValidationEngine;

// node_modules/rdf-validate-datatype/src/validators.js
var Registry = class {
  validators;
  constructor() {
    this.validators = new TermMap_default();
  }
  /**
   * Register a new validator for a specific datatype.
   */
  register(datatype, validatorFunc) {
    this.validators.set(datatype, validatorFunc);
  }
  /**
   * Find validator for a given datatype.
   */
  find(datatype) {
    if (!datatype) {
      return null;
    }
    return this.validators.get(datatype);
  }
};
var validators = new Registry();
validators.register(strict106.anySimpleType, () => true);
validators.register(strict106.anyAtomicType, () => true);
validators.register(strict106.string, () => true);
validators.register(strict106.normalizedString, (value) => isNormalized(value));
validators.register(strict106.token, (value) => isNormalized(value) && !value.startsWith(" ") && !value.endsWith(" ") && !value.includes("  "));
function isNormalized(value) {
  const forbiddenChars = ["\n", "\r", "	"];
  return !forbiddenChars.some((forbiddenChar) => value.includes(forbiddenChar));
}
var languagePattern = /^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$/;
validators.register(strict106.language, (value) => languagePattern.test(value));
var anyURIPattern = /^[^\ufffe\uffff]*$/;
validators.register(strict106.anyURI, (value) => anyURIPattern.test(value));
var signSeg = "(\\+|-)?";
var integerPattern = new RegExp(`^${signSeg}\\d+$`);
validators.register(strict106.integer, (value) => integerPattern.test(value));
validators.register(strict106.nonNegativeInteger, (value) => integerPattern.test(value) && BigInt(value) >= BigInt("0"));
validators.register(strict106.positiveInteger, (value) => integerPattern.test(value) && BigInt(value) > BigInt("0"));
validators.register(strict106.nonPositiveInteger, (value) => integerPattern.test(value) && BigInt(value) <= BigInt("0"));
validators.register(strict106.negativeInteger, (value) => integerPattern.test(value) && BigInt(value) < BigInt("0"));
validators.register(strict106.int, (value) => integerPattern.test(value) && BigInt(value) >= BigInt("-2147483647") && BigInt(value) <= BigInt("2147483648"));
validators.register(strict106.unsignedInt, (value) => integerPattern.test(value) && BigInt(value) >= BigInt("0") && BigInt(value) <= BigInt("4294967295"));
validators.register(strict106.long, (value) => integerPattern.test(value) && BigInt(value) >= BigInt("-9223372036854775808") && BigInt(value) <= BigInt("9223372036854775807"));
validators.register(strict106.unsignedLong, (value) => integerPattern.test(value) && BigInt(value) >= BigInt("0") && BigInt(value) <= BigInt("18446744073709551615"));
validators.register(strict106.short, (value) => integerPattern.test(value) && BigInt(value) >= BigInt("-32768") && BigInt(value) <= BigInt("32767"));
validators.register(strict106.unsignedShort, (value) => integerPattern.test(value) && BigInt(value) >= BigInt("0") && BigInt(value) <= BigInt("65535"));
validators.register(strict106.byte, (value) => integerPattern.test(value) && BigInt(value) >= BigInt("-128") && BigInt(value) <= BigInt("127"));
validators.register(strict106.unsignedByte, (value) => integerPattern.test(value) && BigInt(value) >= BigInt("0") && BigInt(value) <= BigInt("255"));
validators.register(strict106.boolean, (value) => value === "1" || value === "true" || value === "0" || value === "false");
var decimalSeg = `${signSeg}(\\d+\\.?\\d*|\\.\\d+)`;
var decimalPattern = new RegExp(`^${signSeg}${decimalSeg}$`);
validators.register(strict106.decimal, (value) => decimalPattern.test(value));
validators.register(strict106.float, validateFloat);
validators.register(strict106.double, validateFloat);
var floatPattern = new RegExp(`^${signSeg}${decimalSeg}((E|e)(\\+|-)?\\d+)?$`);
function validateFloat(value) {
  return value === "INF" || value === "-INF" || value === "NaN" || floatPattern.test(value);
}
var dateSignSeg = "-?";
var durationYearSeg = "\\d+Y";
var durationMonthSeg = "\\d+M";
var durationDaySeg = "\\d+D";
var durationHourSeg = "\\d+H";
var durationMinuteSeg = "\\d+M";
var durationSecondSeg = "\\d+(\\.\\d+)?S";
var durationYearMonthSeg = `(${durationYearSeg}(${durationMonthSeg})?|${durationMonthSeg})`;
var durationTimeSeg = `T((${durationHourSeg}(${durationMinuteSeg})?(${durationSecondSeg})?)|(${durationMinuteSeg}(${durationSecondSeg})?)|${durationSecondSeg})`;
var durationDayTimeSeg = `(${durationDaySeg}(${durationTimeSeg})?|${durationTimeSeg})`;
var durationSeg = `${dateSignSeg}P((${durationYearMonthSeg}(${durationDayTimeSeg})?)|${durationDayTimeSeg})`;
var durationPattern = new RegExp(`^${durationSeg}$`);
validators.register(strict106.duration, (value) => durationPattern.test(value));
var dayTimeDurationPattern = new RegExp(`^${dateSignSeg}P${durationDayTimeSeg}$`);
validators.register(strict106.dayTimeDuration, (value) => dayTimeDurationPattern.test(value));
var yearMonthDurationPattern = new RegExp(`^${dateSignSeg}P${durationYearMonthSeg}$`);
validators.register(strict106.yearMonthDuration, (value) => yearMonthDurationPattern.test(value));
var yearSeg = `${dateSignSeg}(([1-9]\\d{3,})|(0\\d{3}))`;
var timezoneSeg = "(((\\+|-)\\d{2}:\\d{2})|Z)";
var monthSeg = "\\d{2}";
var daySeg = "\\d{2}";
var dateSeg = `${yearSeg}-${monthSeg}-${daySeg}`;
var timeSeg = "\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?";
var dateTimePattern = new RegExp(`^${dateSeg}T${timeSeg}${timezoneSeg}?$`);
validators.register(strict106.dateTime, (value) => dateTimePattern.test(value));
var dateTimeStampPattern = new RegExp(`^${dateSeg}T${timeSeg}${timezoneSeg}$`);
validators.register(strict106.dateTimeStamp, (value) => dateTimeStampPattern.test(value));
var datePattern = new RegExp(`^${dateSeg}${timezoneSeg}?$`);
validators.register(strict106.date, (value) => datePattern.test(value));
var dayPattern = new RegExp(`^${daySeg}${timezoneSeg}?$`);
validators.register(strict106.gDay, (value) => dayPattern.test(value));
var monthPattern = new RegExp(`^--${monthSeg}${timezoneSeg}?$`);
validators.register(strict106.gMonth, (value) => monthPattern.test(value));
var monthDayPattern = new RegExp(`^${monthSeg}-${daySeg}${timezoneSeg}?$`);
validators.register(strict106.gMonthDay, (value) => monthDayPattern.test(value));
var yearPattern = new RegExp(`^${yearSeg}${timezoneSeg}?$`);
validators.register(strict106.gYear, (value) => yearPattern.test(value));
var yearMonthPattern = new RegExp(`^${yearSeg}-${monthSeg}${timezoneSeg}?$`);
validators.register(strict106.gYearMonth, (value) => yearMonthPattern.test(value));
var timePattern = new RegExp(`^${timeSeg}${timezoneSeg}?$`);
validators.register(strict106.time, (value) => timePattern.test(value));
var hexBinaryPattern = /^([0-9a-fA-F]{2})*$/;
validators.register(strict106.hexBinary, (value) => hexBinaryPattern.test(value));
var b64CharSeg = "[A-Za-z0-9+/]";
var b16CharSeg = "[AEIMQUYcgkosw048]";
var b04CharSeg = "[AQgw]";
var b64Seg = `(${b64CharSeg} ?)`;
var b16Seg = `(${b16CharSeg} ?)`;
var b04Seg = `(${b04CharSeg} ?)`;
var b64Padded16Seg = `(${b64Seg}{2}${b16Seg}=)`;
var b64Padded8Seg = `(${b64Seg}${b04Seg}= ?=)`;
var b64QuadSeg = `(${b64Seg}{4})`;
var b64FinalQuadSeg = `(${b64Seg}{3}${b64CharSeg})`;
var b64FinalSeg = `(${b64FinalQuadSeg}|${b64Padded16Seg}|${b64Padded8Seg})`;
var b64Pattern = new RegExp(`^(${b64QuadSeg}*${b64FinalSeg})?$`);
validators.register(strict106.base64Binary, (value) => b64Pattern.test(value));
validators.register(strict9.JSON, (value) => {
  try {
    JSON.parse(value);
    return true;
  } catch (e) {
    return false;
  }
});
validators.register(strict106.NOTATION, () => true);
validators.register(strict106.QName, () => true);
validators.register(strict106.Name, () => true);
validators.register(strict106.NCName, () => true);
validators.register(strict106.ENTITY, () => true);
validators.register(strict106.ID, () => true);
validators.register(strict106.IDREF, () => true);
validators.register(strict106.NMTOKEN, () => true);
validators.register(strict106.ENTITIES, () => true);
validators.register(strict106.IDREFS, () => true);
validators.register(strict106.NMTOKENS, () => true);
validators.register(strict68.XMLLiteral, () => true);
validators.register(strict68.HTML, () => true);

// node_modules/rdf-validate-datatype/src/validate-term.js
function validateTerm(term2) {
  if (term2.termType !== "Literal") {
    throw new Error("Cannot validate non-literal terms");
  }
  const validator = validators.find(term2.datatype);
  if (validator) {
    return validator(term2.value);
  }
  return true;
}

// node_modules/rdf-validate-shacl/src/validators.js
var import_rdf_literal = __toESM(require_rdf_literal(), 1);
var validateAnd = {
  validate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const andNode = constraint.getParameterValue(sh.and);
    const shapes = rdfListToArray(context2.$shapes.node(andNode));
    return shapes.every((shape) => {
      if (constraint.shape.isPropertyShape) {
        return context2.nodeConformsToShape(focusNode, shape, constraint.pathObject);
      }
      return context2.nodeConformsToShape(valueNode, shape);
    });
  }
};
var validateClass = {
  validate(context2, focusNode, valueNode, constraint) {
    const classNode = constraint.getParameterValue(namespaces_default.sh.class);
    return isInstanceOf(context2.$data.node(valueNode), context2.$data.node(classNode), context2.ns);
  }
};
var validateClosed = {
  validate(context2, focusNode, valueNode, constraint) {
    const { sh, xsd: xsd4 } = context2.ns;
    const closedNode = constraint.getParameterValue(sh.closed);
    const ignoredPropertiesNode = constraint.getParameterValue(sh.ignoredProperties);
    const currentShape = constraint.shape.shapeNode;
    const trueTerm = context2.factory.literal("true", xsd4.boolean);
    if (!trueTerm.equals(closedNode)) {
      return;
    }
    const allowed = new node_set_default(context2.$shapes.node(currentShape).out(sh.property).out(sh.path).terms.filter((term2) => term2.termType === "NamedNode"));
    if (ignoredPropertiesNode) {
      allowed.addAll(rdfListToArray(context2.$shapes.node(ignoredPropertiesNode)));
    }
    const results = [];
    const valueQuads = [...context2.$data.dataset.match(valueNode, null, null)];
    valueQuads.filter(({ predicate }) => !allowed.has(predicate)).forEach(({ predicate, object }) => {
      results.push({ path: predicate, value: object });
    });
    return results;
  },
  validationMessage: "Predicate is not allowed (closed shape)"
};
var validateDatatype = {
  validate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const datatypeNode = constraint.getParameterValue(sh.datatype);
    if (valueNode.termType === "Literal") {
      return valueNode.datatype.equals(datatypeNode) && validateTerm(valueNode);
    } else {
      return false;
    }
  },
  validationMessage: "Value does not have datatype {$datatype}"
};
var validateDisjoint = {
  validate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const disjointNode = constraint.getParameterValue(sh.disjoint);
    return context2.$data.dataset.match(focusNode, disjointNode, valueNode).size === 0;
  },
  validationMessage: "Value node must not also be one of the values of {$disjoint}"
};
var validateEquals = {
  propertyValidate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const path = constraint.shape.pathObject;
    const equalsNode = constraint.getParameterValue(sh.equals);
    const results = [];
    getPathObjects(context2.$data, focusNode, path).forEach((value) => {
      if (context2.$data.dataset.match(focusNode, equalsNode, value).size === 0) {
        results.push({ value });
      }
    });
    const equalsQuads = [...context2.$data.dataset.match(focusNode, equalsNode, null)];
    equalsQuads.forEach(({ object }) => {
      const value = object;
      if (!getPathObjects(context2.$data, focusNode, path).some((pathValue) => pathValue.equals(value))) {
        results.push({ value });
      }
    });
    return results;
  },
  propertyValidationMessage: "Must have same values as {$equals}",
  nodeValidate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const equalsNode = constraint.getParameterValue(sh.equals);
    const results = [];
    let solutions = 0;
    getPathObjects(context2.$data, focusNode, equalsNode).forEach((value) => {
      solutions++;
      if (!value.equals(focusNode)) {
        results.push({ value });
      }
    });
    if (results.length === 0 && solutions === 0) {
      results.push({ value: focusNode });
    }
    return results;
  },
  nodeValidationMessage: "Must have same values as {$equals}"
};
var validateHasValue = {
  nodeValidate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const hasValueNode = constraint.getParameterValue(sh.hasValue);
    return focusNode.equals(hasValueNode);
  },
  nodeValidationMessage: "Value must be {$hasValue}",
  propertyValidate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const path = constraint.shape.pathObject;
    const hasValueNode = constraint.getParameterValue(sh.hasValue);
    return getPathObjects(context2.$data, focusNode, path).some((value) => value.equals(hasValueNode));
  },
  propertyValidationMessage: "Missing expected value {$hasValue}"
};
var validateIn = {
  validate(context2, focusNode, valueNode, constraint) {
    return constraint.nodeSet.has(valueNode);
  },
  validationMessage: "Value is not one of the allowed values: {$in}"
};
var validateLanguageIn = {
  validate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    if (valueNode.termType !== "Literal") {
      return false;
    }
    const valueLanguage = valueNode.language;
    if (!valueLanguage || valueLanguage === "") {
      return false;
    }
    const languageInNode = constraint.getParameterValue(sh.languageIn);
    const allowedLanguages = rdfListToArray(context2.$shapes.node(languageInNode));
    return allowedLanguages.some((allowedLanguage) => valueLanguage.startsWith(allowedLanguage.value));
  },
  validationMessage: "Language does not match any of {$languageIn}"
};
var validateLessThan = {
  propertyValidate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const valuePath = constraint.shape.pathObject;
    const values2 = getPathObjects(context2.$data, focusNode, valuePath);
    const lessThanNode = constraint.getParameterValue(sh.lessThan);
    const referenceValues = context2.$data.node(focusNode).out(lessThanNode).terms;
    const invalidValues = [];
    for (const value of values2) {
      for (const referenceValue of referenceValues) {
        const c3 = compareTerms(value, referenceValue, context2.ns);
        if (c3 === null || c3 >= 0) {
          invalidValues.push({ value });
        }
      }
    }
    return invalidValues;
  },
  propertyValidationMessage: "Value is not less than value of {$lessThan}"
};
var validateLessThanOrEquals = {
  propertyValidate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const valuePath = constraint.shape.pathObject;
    const values2 = getPathObjects(context2.$data, focusNode, valuePath);
    const lessThanOrEqualsNode = constraint.getParameterValue(sh.lessThanOrEquals);
    const referenceValues = context2.$data.node(focusNode).out(lessThanOrEqualsNode).terms;
    const invalidValues = [];
    for (const value of values2) {
      for (const referenceValue of referenceValues) {
        const c3 = compareTerms(value, referenceValue, context2.ns);
        if (c3 === null || c3 > 0) {
          invalidValues.push({ value });
        }
      }
    }
    return invalidValues;
  },
  propertyValidationMessage: "Value is not less than or equal to value of {$lessThanOrEquals}"
};
var validateMaxCount = {
  propertyValidate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const path = constraint.shape.pathObject;
    const count = getPathObjects(context2.$data, focusNode, path).length;
    const maxCountNode = constraint.getParameterValue(sh.maxCount);
    return maxCountNode && count <= Number(maxCountNode.value);
  },
  propertyValidationMessage: "More than {$maxCount} values"
};
var validateMaxExclusive = {
  validate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const maxExclusiveNode = constraint.getParameterValue(sh.maxExclusive);
    const comp = compareTerms(valueNode, maxExclusiveNode, context2.ns);
    return comp !== null && comp < 0;
  },
  validationMessage: "Value is not less than {$maxExclusive}"
};
var validateMaxInclusive = {
  validate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const maxInclusiveNode = constraint.getParameterValue(sh.maxInclusive);
    const comp = compareTerms(valueNode, maxInclusiveNode, context2.ns);
    return comp !== null && comp <= 0;
  },
  validationMessage: "Value is not less than or equal to {$maxInclusive}"
};
var validateMaxLength = {
  validate(context2, focusNode, valueNode, constraint) {
    if (valueNode.termType === "BlankNode") {
      return false;
    }
    const { sh } = context2.ns;
    const maxLengthNode = constraint.getParameterValue(sh.maxLength);
    return valueNode.value.length <= Number(maxLengthNode.value);
  },
  validationMessage: "Value has more than {$maxLength} characters"
};
var validateMinCount = {
  propertyValidate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const path = constraint.pathObject;
    const count = getPathObjects(context2.$data, focusNode, path).length;
    const minCountNode = constraint.getParameterValue(sh.minCount);
    return count >= Number(minCountNode.value);
  },
  propertyValidationMessage: "Less than {$minCount} values"
};
var validateMinExclusive = {
  validate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const minExclusiveNode = constraint.getParameterValue(sh.minExclusive);
    const comp = compareTerms(valueNode, minExclusiveNode, context2.ns);
    return comp !== null && comp > 0;
  },
  validationMessage: "Value is not greater than {$minExclusive}"
};
var validateMinInclusive = {
  validate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const minInclusiveNode = constraint.getParameterValue(sh.minInclusive);
    const comp = compareTerms(valueNode, minInclusiveNode, context2.ns);
    return comp !== null && comp >= 0;
  },
  validationMessage: "Value is not greater than or equal to {$minInclusive}"
};
var validateMinLength = {
  validate(context2, focusNode, valueNode, constraint) {
    if (valueNode.termType === "BlankNode") {
      return false;
    }
    const { sh } = context2.ns;
    const minLengthNode = constraint.getParameterValue(sh.minLength);
    return valueNode.value.length >= Number(minLengthNode.value);
  },
  validationMessage: "Value has less than {$minLength} characters"
};
var validateNodeKind = {
  validate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const nodeKindNode = constraint.getParameterValue(sh.nodeKind);
    if (valueNode.termType === "BlankNode") {
      return sh.BlankNode.equals(nodeKindNode) || sh.BlankNodeOrIRI.equals(nodeKindNode) || sh.BlankNodeOrLiteral.equals(nodeKindNode);
    } else if (valueNode.termType === "NamedNode") {
      return sh.IRI.equals(nodeKindNode) || sh.BlankNodeOrIRI.equals(nodeKindNode) || sh.IRIOrLiteral.equals(nodeKindNode);
    } else if (valueNode.termType === "Literal") {
      return sh.Literal.equals(nodeKindNode) || sh.BlankNodeOrLiteral.equals(nodeKindNode) || sh.IRIOrLiteral.equals(nodeKindNode);
    }
  },
  validationMessage: "Value does not have node kind {$nodeKind}"
};
var validateNode = {
  validate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const nodeNode = constraint.getParameterValue(sh.node);
    return context2.validateNodeAgainstShape(valueNode, nodeNode);
  },
  validationMessage: "Value does not have shape {$node}"
};
var validateNot = {
  validate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const notNode = constraint.getParameterValue(sh.not);
    return !context2.nodeConformsToShape(valueNode, notNode);
  },
  validationMessage: "Value does have shape {$not}"
};
var validateOr = {
  validate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const orNode = constraint.getParameterValue(sh.or);
    const shapes = rdfListToArray(context2.$shapes.node(orNode));
    return shapes.some((shape) => context2.nodeConformsToShape(valueNode, shape));
  }
};
var validatePattern = {
  validate(context2, focusNode, valueNode, constraint) {
    if (valueNode.termType === "BlankNode") {
      return false;
    }
    const { sh } = context2.ns;
    const flagsNode = constraint.getParameterValue(sh.flags);
    const patternNode = constraint.getParameterValue(sh.pattern);
    const re = flagsNode ? new RegExp(patternNode.value, flagsNode.value) : new RegExp(patternNode.value);
    return re.test(valueNode.value);
  },
  validationMessage: 'Value does not match pattern "{$pattern}"'
};
var validateQualifiedMaxCount = {
  propertyValidate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const count = validateQualifiedHelper(context2, focusNode, constraint);
    const qualifiedMaxCountNode = constraint.getParameterValue(sh.qualifiedMaxCount);
    return qualifiedMaxCountNode.termType === "Literal" && count <= Number(qualifiedMaxCountNode.value);
  },
  propertyValidationMessage: "More than {$qualifiedMaxCount} values have shape {$qualifiedValueShape}"
};
var validateQualifiedMinCount = {
  propertyValidate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const count = validateQualifiedHelper(context2, focusNode, constraint);
    const qualifiedMinCountNode = constraint.getParameterValue(sh.qualifiedMinCount);
    return qualifiedMinCountNode.termType === "Literal" && count >= Number(qualifiedMinCountNode.value);
  },
  propertyValidationMessage: "Less than {$qualifiedMinCount} values have shape {$qualifiedValueShape}"
};
function validateQualifiedHelper(context2, focusNode, constraint) {
  const { sh, xsd: xsd4 } = context2.ns;
  const currentShapeNode = constraint.shape.shapeNode;
  const qualifiedValueShapesDisjointNode = constraint.getParameterValue(sh.qualifiedValueShapesDisjoint);
  const qualifiedValueShapeNode = constraint.getParameterValue(sh.qualifiedValueShape);
  const trueTerm = context2.factory.literal("true", xsd4.boolean);
  const siblingShapes = new node_set_default();
  if (trueTerm.equals(qualifiedValueShapesDisjointNode)) {
    const qualifiedSiblingShapes = context2.$shapes.node(currentShapeNode).in(sh.property).out(sh.property).out(sh.qualifiedValueShape).filter(({ term: term2 }) => !term2.equals(qualifiedValueShapeNode)).terms;
    siblingShapes.addAll(qualifiedSiblingShapes);
  }
  const path = constraint.shape.pathObject;
  return getPathObjects(context2.$data, focusNode, path).filter((value) => context2.nodeConformsToShape(value, qualifiedValueShapeNode) && !validateQualifiedConformsToASibling(context2, value, [...siblingShapes])).length;
}
function validateQualifiedConformsToASibling(context2, value, siblingShapes) {
  for (let i2 = 0; i2 < siblingShapes.length; i2++) {
    if (context2.nodeConformsToShape(value, siblingShapes[i2])) {
      return true;
    }
  }
  return false;
}
var validateUniqueLang = {
  propertyValidate(context2, focusNode, valueNode, constraint) {
    const { sh, xsd: xsd4 } = context2.ns;
    const uniqueLangNode = constraint.getParameterValue(sh.uniqueLang);
    const trueTerm = context2.factory.literal("true", xsd4.boolean);
    if (!trueTerm.equals(uniqueLangNode)) {
      return;
    }
    const path = constraint.shape.pathObject;
    const map = {};
    getPathObjects(context2.$data, focusNode, path).forEach((value) => {
      if (value.termType === "Literal" && value.language && value.language !== "") {
        const old = map[value.language];
        if (!old) {
          map[value.language] = 1;
        } else {
          map[value.language] = old + 1;
        }
      }
    });
    const results = [];
    for (const lang in map) {
      if (Object.prototype.hasOwnProperty.call(map, lang)) {
        const count = map[lang];
        if (count > 1) {
          results.push('Language "' + lang + '" has been used by ' + count + " values");
        }
      }
    }
    return results;
  },
  propertyValidationMessage: 'Language "{?lang}" used more than once'
};
var validateXone = {
  validate(context2, focusNode, valueNode, constraint) {
    const { sh } = context2.ns;
    const xoneNode = constraint.getParameterValue(sh.xone);
    const shapes = rdfListToArray(context2.$shapes.node(xoneNode));
    const conformsCount = shapes.map((shape) => context2.nodeConformsToShape(valueNode, shape)).filter(Boolean).length;
    return conformsCount === 1;
  }
};
function compareTerms(term1, term2, ns2) {
  if (!term1 || !term2 || term1.termType !== "Literal" || term2.termType !== "Literal") {
    return null;
  }
  if (hasTimezone(term1, ns2) !== hasTimezone(term2, ns2)) {
    return null;
  }
  const value1 = (0, import_rdf_literal.fromRdf)(term1);
  const value2 = (0, import_rdf_literal.fromRdf)(term2);
  if (typeof value1 !== typeof value2) {
    return null;
  }
  if (typeof value1 === "string") {
    return value1.localeCompare(value2);
  } else {
    return value1 - value2;
  }
}
function hasTimezone(node, ns2) {
  const pattern = /^.*(((\+|-)\d{2}:\d{2})|Z)$/;
  return ns2.xsd.dateTime.equals(node.datatype) && pattern.test(node.value);
}
var validators_default = {
  validateAnd,
  validateClass,
  validateClosed,
  validateDatatype,
  validateDisjoint,
  validateEquals,
  validateHasValue,
  validateIn,
  validateLanguageIn,
  validateLessThan,
  validateLessThanOrEquals,
  validateMaxCount,
  validateMaxExclusive,
  validateMaxInclusive,
  validateMaxLength,
  validateMinCount,
  validateMinExclusive,
  validateMinInclusive,
  validateMinLength,
  validateNode,
  validateNodeKind,
  validateNot,
  validateOr,
  validatePattern,
  validateQualifiedMaxCount,
  validateQualifiedMinCount,
  validateUniqueLang,
  validateXone
};

// node_modules/rdf-validate-shacl/src/validators-registry.js
var validators_registry_default = [
  [namespaces_default.sh.AndConstraintComponent, validators_default.validateAnd],
  [namespaces_default.sh.ClassConstraintComponent, validators_default.validateClass],
  [namespaces_default.sh.ClosedConstraintComponent, validators_default.validateClosed],
  [namespaces_default.sh.DatatypeConstraintComponent, validators_default.validateDatatype],
  [namespaces_default.sh.DisjointConstraintComponent, validators_default.validateDisjoint],
  [namespaces_default.sh.EqualsConstraintComponent, validators_default.validateEquals],
  [namespaces_default.sh.HasValueConstraintComponent, validators_default.validateHasValue],
  [namespaces_default.sh.InConstraintComponent, validators_default.validateIn],
  [namespaces_default.sh.LanguageInConstraintComponent, validators_default.validateLanguageIn],
  [namespaces_default.sh.LessThanConstraintComponent, validators_default.validateLessThan],
  [namespaces_default.sh.LessThanOrEqualsConstraintComponent, validators_default.validateLessThanOrEquals],
  [namespaces_default.sh.MaxCountConstraintComponent, validators_default.validateMaxCount],
  [namespaces_default.sh.MaxExclusiveConstraintComponent, validators_default.validateMaxExclusive],
  [namespaces_default.sh.MaxInclusiveConstraintComponent, validators_default.validateMaxInclusive],
  [namespaces_default.sh.MaxLengthConstraintComponent, validators_default.validateMaxLength],
  [namespaces_default.sh.MinCountConstraintComponent, validators_default.validateMinCount],
  [namespaces_default.sh.MinExclusiveConstraintComponent, validators_default.validateMinExclusive],
  [namespaces_default.sh.MinInclusiveConstraintComponent, validators_default.validateMinInclusive],
  [namespaces_default.sh.MinLengthConstraintComponent, validators_default.validateMinLength],
  [namespaces_default.sh.NodeConstraintComponent, validators_default.validateNode],
  [namespaces_default.sh.NodeKindConstraintComponent, validators_default.validateNodeKind],
  [namespaces_default.sh.NotConstraintComponent, validators_default.validateNot],
  [namespaces_default.sh.OrConstraintComponent, validators_default.validateOr],
  [namespaces_default.sh.PatternConstraintComponent, validators_default.validatePattern],
  [namespaces_default.sh.QualifiedMaxCountConstraintComponent, validators_default.validateQualifiedMaxCount],
  [namespaces_default.sh.QualifiedMinCountConstraintComponent, validators_default.validateQualifiedMinCount],
  [namespaces_default.sh.UniqueLangConstraintComponent, validators_default.validateUniqueLang],
  [namespaces_default.sh.XoneConstraintComponent, validators_default.validateXone]
];

// node_modules/rdf-validate-shacl/index.js
var SHACLValidator = class {
  importsLoaded = false;
  /**
   * @param shapes - Dataset containing the SHACL shapes for validation
   * @param {object} [options] - Validator options
   */
  constructor(shapes, options) {
    options = options || {};
    this.factory = options.factory || defaultEnv_default;
    this.ns = prepareNamespaces(this.factory);
    this.allowNamedNodeInList = options.allowNamedNodeInList === void 0 ? false : options.allowNamedNodeInList;
    const dataset2 = this.factory.dataset([...shapes]);
    this.$shapes = this.factory.clownface({ dataset: dataset2 });
    this.$data = this.factory.clownface();
    this.validators = this.factory.termMap(validators_registry_default);
    this.shapesGraph = new shapes_graph_default(this);
    this.validationEngine = new validation_engine_default(this, options);
    if (options.importGraph) {
      this.importGraph = options.importGraph;
    }
    this.depth = 0;
  }
  /**
   * Validates the provided data graph against the provided shapes graph
   */
  async validate(dataGraph) {
    await this.loadOwlImports();
    this.setDataGraph(dataGraph);
    this.validationEngine.validateAll(this.$data);
    return this.validationEngine.getReport();
  }
  /**
   * Validates the provided focus node against the provided shape
   */
  async validateNode(dataGraph, focusNode, shapeNode) {
    await this.loadOwlImports();
    this.setDataGraph(dataGraph);
    this.nodeConformsToShape(focusNode, shapeNode, this.validationEngine);
    return this.validationEngine.getReport();
  }
  setDataGraph(dataGraph) {
    if ("dataset" in dataGraph) {
      this.$data = dataGraph;
    } else {
      this.$data = this.factory.clownface({ dataset: dataGraph });
    }
  }
  /**
   * Exposed to be available from validation functions as `SHACL.nodeConformsToShape`
   */
  nodeConformsToShape(focusNode, shapeNode, propertyPathOrEngine) {
    let engine;
    let shape = this.shapesGraph?.getShape(shapeNode);
    if (propertyPathOrEngine && "termType" in propertyPathOrEngine) {
      engine = this.validationEngine.clone({
        recordErrorsLevel: this.validationEngine.recordErrorsLevel
      });
      shape = shape.overridePath(propertyPathOrEngine);
    } else if (propertyPathOrEngine && "clone" in propertyPathOrEngine) {
      engine = propertyPathOrEngine;
    } else {
      engine = this.validationEngine.clone();
    }
    try {
      this.depth++;
      const foundViolations = engine.validateNodeAgainstShape(focusNode, shape, this.$data);
      return !foundViolations;
    } finally {
      this.depth--;
    }
  }
  validateNodeAgainstShape(focusNode, shapeNode) {
    return this.nodeConformsToShape(focusNode, shapeNode, this.validationEngine);
  }
  async loadOwlImports() {
    if (this.importsLoaded) {
      return;
    }
    this.importsLoaded = true;
    const { owl } = this.ns;
    const loaded = new TermSet_default();
    const doLoad = async (url) => {
      if (!this.importGraph) {
        throw new Error("importGraph parameter is required to load owl:imports");
      }
      const imported = await this.importGraph(url);
      for (const quad3 of imported) {
        this.$shapes.dataset.add(quad3);
      }
      return imported;
    };
    const loadFromDataset = (dataset2) => {
      const toImport = new TermSet_default();
      for (const { object } of dataset2.match(null, owl.imports)) {
        if (object.termType === "NamedNode" && !loaded.has(object) && !toImport.has(object)) {
          loaded.add(object);
          toImport.add(object);
        }
      }
      return Promise.all([...toImport].map(async (url) => {
        await loadFromDataset(await doLoad(url));
      }));
    };
    await loadFromDataset(this.$shapes.dataset);
  }
};
var rdf_validate_shacl_default = SHACLValidator;

// src/validate/ShapeValidator.js
var WARNING = "http://www.w3.org/ns/shacl#Warning";
var ShapeValidator = class {
  #validator;
  constructor(shapes) {
    this.#validator = new rdf_validate_shacl_default(shapes, { factory: env_default });
  }
  /**
   * Returns { conforms, violations, warnings, results }.
   *
   * `conforms` is corrected here and deliberately differs from what
   * rdf-validate-shacl reports. SHACL section 3.6 says a result of warning
   * severity does not make a graph non-conformant; the library reports
   * conforms: false for any result at all. Callers refuse to store a
   * non-conformant graph, so without this correction one odd string of
   * warning severity would abort an entire harvest.
   */
  async validate(data) {
    const report = await this.#validator.validate(data);
    const results = report.results.map((r) => ({
      severity: r.severity?.value ?? null,
      focusNode: r.focusNode?.value ?? null,
      path: r.path?.value ?? null,
      message: r.message.map((m) => m.value).join(" ")
    }));
    const violations = results.filter((r) => r.severity !== WARNING);
    const warnings = results.filter((r) => r.severity === WARNING);
    return { conforms: violations.length === 0, violations, warnings, results };
  }
};

// src/host/HostConfig.js
var HOST_CONFIG_KEYS = Object.freeze({
  // Plugin payloads relayed per second, in each direction, between a plugin's
  // own interface and its processor (docs/messaging.md 2.4).
  relayPerSecond: "a whole number of messages per second, at least 1",
  // How far ahead of the audio clock the clip scheduler sends notes, and how
  // often it looks. The lookahead must comfortably exceed the tick, or a
  // late timer leaves a gap nothing was scheduled into. src/engine/Scheduler.js.
  schedulerLookaheadMs: "a whole number of milliseconds, at least 1",
  schedulerTickMs: "a whole number of milliseconds, at least 1",
  // The local MCP bridge (bin/mcp-bridge.js), which reads this same file: the
  // loopback port it listens on and the page connects to, and how long a tool
  // call waits for the page. A plugin load can take seconds.
  bridgePort: "a TCP port, 1 to 65535",
  bridgeCallTimeoutMs: "a whole number of milliseconds, at least 1",
  // Delay each track by however much less latency it has than the slowest, so
  // parallel tracks arrive together (docs/latency.md, "Between tracks"). This is
  // the starting value; a person can change it on the Mixer tab, and that choice
  // is remembered in their browser and wins over this file.
  alignTracks: "true or false",
  // The longest delay a track can be given to align it, which is the largest
  // latency difference between two tracks the page can put right.
  maxTrackDelayMs: "a whole number of milliseconds, at least 1",
  // How long a piece carried from one page to the other (src/host/Handoff.js) is offered. After this it is
  // forgotten, so a piece left over from last week is not offered as if it were what was just open.
  handoffMinutes: "a whole number of minutes, at least 1",
  // How often the studio page keeps a recovery copy of the open session, when it has changed (src/host/Recovery.js).
  recoverySeconds: "a whole number of seconds, at least 1"
});
var BOOLEAN_KEYS = /* @__PURE__ */ new Set(["alignTracks"]);
function readHostConfig(json) {
  if (!json || typeof json !== "object") throw new Error("web/host.json is not a JSON object");
  const settings = {};
  for (const [key, what] of Object.entries(HOST_CONFIG_KEYS)) {
    const value = json[key];
    if (value === void 0) throw new Error(`web/host.json has no ${key}: it must be ${what}`);
    if (BOOLEAN_KEYS.has(key)) {
      if (typeof value !== "boolean") throw new Error(`web/host.json ${key} is ${JSON.stringify(value)}: it must be ${what}`);
      settings[key] = value;
      continue;
    }
    if (!Number.isInteger(value) || value < 1) throw new Error(`web/host.json ${key} is ${JSON.stringify(value)}: it must be ${what}`);
    settings[key] = value;
  }
  if (settings.bridgePort > 65535) throw new Error(`web/host.json bridgePort is ${settings.bridgePort}: it must be ${HOST_CONFIG_KEYS.bridgePort}`);
  if (settings.schedulerLookaheadMs <= settings.schedulerTickMs) {
    throw new Error(`web/host.json schedulerLookaheadMs (${settings.schedulerLookaheadMs}) must exceed schedulerTickMs (${settings.schedulerTickMs}), or a tick that runs late leaves a gap no note was scheduled into`);
  }
  return Object.freeze(settings);
}

// web/jigeq-abc.js
var PLUGINS = Object.freeze([
  { key: "a", name: "JigEQa" },
  { key: "b", name: "JigEQb" },
  { key: "c", name: "JigEQc" }
]);
var $ = (selector) => document.querySelector(selector);
var wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
var entries = new Map(PLUGINS.map((spec) => [spec.key, { ...spec, values: /* @__PURE__ */ new Map() }]));
var status = $("#status");
var startButton = $("#audio-toggle");
var loader;
var capabilities;
var relayLimit;
var activeKey = "a";
var context = null;
var inputGain = null;
var monitorGain = null;
var switchGain = null;
var source = null;
var playingEntry = null;
var playing = false;
var switchRequest = 0;
function say(message, state = "info") {
  status.textContent = message;
  status.dataset.state = state;
}
function setNote(entry, message, state = "info") {
  const note = $(`#panel-${entry.key} .plugin-note`);
  note.textContent = message;
  note.dataset.state = state;
}
function gainFromDb(db) {
  return 10 ** (db / 20);
}
function parameterChanged(entry, symbol, requested) {
  const port = entry.profile?.ports.find((item) => item.symbol === symbol);
  if (!port || !Number.isFinite(requested)) {
    setNote(entry, `${entry.name}: refused invalid parameter update for "${symbol}".`, "error");
    return;
  }
  const value = Math.min(port.maximum, Math.max(port.minimum, requested));
  const parameter = entry.node?.parameters.get(symbol);
  if (entry.node && !parameter) {
    setNote(entry, `${entry.name}: the processor has no AudioParam named "${symbol}".`, "error");
    return;
  }
  entry.values.set(symbol, value);
  parameter?.setValueAtTime(value, context.currentTime);
  entry.panel?.update(symbol, value);
  entry.frame?.parameter(symbol, value);
}
async function loadEntry(entry) {
  try {
    const iri4 = new URL(`/plugins/jigeq${entry.key}/`, document.baseURI).href;
    const loaded = await loader.loadProfile(iri4);
    entry.profile = loaded.profile;
    entry.granted = loaded.granted;
    for (const port of entry.profile.ports) entry.values.set(port.symbol, port.defaultValue);
    let skin = null;
    if (entry.profile.skin) {
      try {
        const fetched = await loadSkin(entry.profile, {
          fetchVerified: (resource, options) => loader.fetchVerified(resource, options),
          parseTurtle: parseText,
          parseSvg,
          parseHtml
        });
        skin = prepareSkin(fetched, entry.profile, {
          document,
          prefix: `jigeq-harness-${entry.key}-`
        });
      } catch (error2) {
        setNote(entry, `${entry.name} skin failed; showing generated controls instead. ${error2.message}`, "error");
      }
    }
    entry.panel = createPanel(
      document,
      entry.profile,
      (symbol, value) => parameterChanged(entry, symbol, value),
      null,
      { scope: `jigeq-harness-${entry.key}`, skin }
    );
    $(`#surface-${entry.key}`).append(entry.panel.element);
    if (entry.profile.ui) {
      entry.frame = createPluginFrame(document, {
        ui: entry.profile.ui,
        label: entry.name,
        hostOrigin: window.location.origin,
        window,
        relayLimit,
        init: () => ({
          profile: profileAsJsonLd(entry.profile),
          parameters: Object.fromEntries(entry.values),
          capabilities: [...capabilities].map(compact)
        }),
        onParameter: (symbol, value) => parameterChanged(entry, symbol, value),
        onRefused: (message) => setNote(entry, message, "error")
      });
      entry.frame.element.style.height = "340px";
      const editor = document.createElement("div");
      const heading = document.createElement("h2");
      heading.className = "editor-title";
      heading.textContent = "Plugin HTML editor";
      editor.append(heading, entry.frame.element);
      $(`#surface-${entry.key}`).append(editor);
    }
    if (entry.key === activeKey) entry.panel.skinView?.fit();
    if (!entry.profile.skin || skin) setNote(entry, entry.profile.ui ? "Generated panel and HTML editor" : entry.profile.skin ? "SVG skin" : "Generated panel");
  } catch (error2) {
    setNote(entry, `${entry.name} could not be loaded: ${error2.message}`, "error");
  }
}
async function prepareHost() {
  const [shapesResponse, configResponse] = await Promise.all([
    fetch("/vocabs/shapes.ttl"),
    fetch("/host.json")
  ]);
  if (!shapesResponse.ok) throw new Error(`vocabs/shapes.ttl returned ${shapesResponse.status}`);
  if (!configResponse.ok) throw new Error(`host.json returned ${configResponse.status}`);
  const [shapesText, configJson] = await Promise.all([shapesResponse.text(), configResponse.json()]);
  const shapes = await parseText(shapesText, new URL("/vocabs/shapes.ttl", document.baseURI).href);
  const validator = new ShapeValidator(shapes);
  const config = readHostConfig(configJson);
  capabilities = detectCapabilities(globalThis);
  relayLimit = config.relayPerSecond;
  loader = new PluginLoader({ parse: parseText, validator, capabilities });
  for (const entry of entries.values()) await loadEntry(entry);
  startButton.disabled = false;
  say("Profiles verified. Start white noise to hear the selected EQ.");
}
function makeNoiseSource() {
  const frames = context.sampleRate;
  const buffer = context.createBuffer(2, frames, context.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let frame = 0; frame < data.length; frame++) data[frame] = Math.random() * 2 - 1;
  }
  const noise = context.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  return noise;
}
function ensureContext() {
  if (!context) {
    context = new AudioContext();
    inputGain = context.createGain();
    inputGain.gain.value = gainFromDb(Number($("#noise-level").value));
    switchGain = context.createGain();
    switchGain.gain.value = 0;
    monitorGain = context.createGain();
    monitorGain.gain.value = gainFromDb(Number($("#output-level").value));
    switchGain.connect(monitorGain);
    monitorGain.connect(context.destination);
  }
  return context.resume();
}
async function ensureNode(entry) {
  if (entry.node) return entry.node;
  entry.nodePromise ??= loader.instantiate(entry.profile, entry.granted, context).then(({ node }) => {
    for (const [symbol, value] of entry.values) {
      const parameter = node.parameters.get(symbol);
      if (!parameter) throw new Error(`${entry.name}: the processor has no AudioParam named "${symbol}"`);
      parameter.setValueAtTime(value, context.currentTime);
    }
    entry.node = node;
    return node;
  }).catch((error2) => {
    entry.nodePromise = null;
    throw error2;
  });
  return entry.nodePromise;
}
function setSwitchGain(value) {
  const now = context.currentTime;
  switchGain.gain.cancelScheduledValues(now);
  switchGain.gain.setTargetAtTime(value, now, 0.01);
}
async function routeTo(entry, request) {
  const node = await ensureNode(entry);
  if (!playing || request !== switchRequest || activeKey !== entry.key) return;
  if (playingEntry === entry) {
    setSwitchGain(1);
    return;
  }
  const previous = playingEntry;
  if (previous) {
    setSwitchGain(0);
    await wait(35);
    if (!playing || request !== switchRequest || activeKey !== entry.key) return;
    inputGain.disconnect(previous.node);
    previous.node.disconnect(switchGain);
  }
  node.connect(switchGain);
  inputGain.connect(node);
  playingEntry = entry;
  setSwitchGain(1);
  say(`White noise is playing through ${entry.name} to the default audio output.`);
}
function stopNoise(announce = true) {
  switchRequest++;
  if (source) {
    source.stop();
    source.disconnect();
    source = null;
  }
  if (playingEntry) {
    inputGain.disconnect(playingEntry.node);
    playingEntry.node.disconnect(switchGain);
    playingEntry = null;
  }
  playing = false;
  if (switchGain) setSwitchGain(0);
  startButton.textContent = "Start white noise";
  if (announce) say("White noise stopped.");
}
async function startNoise() {
  startButton.disabled = true;
  try {
    await ensureContext();
    const entry = entries.get(activeKey);
    if (!entry?.profile) throw new Error(`${entry?.name ?? activeKey} profile is not ready`);
    source = makeNoiseSource();
    source.connect(inputGain);
    source.start();
    playing = true;
    startButton.textContent = "Stop white noise";
    await routeTo(entry, ++switchRequest);
  } catch (error2) {
    stopNoise(false);
    say(`Audio could not start: ${error2.message}`, "error");
  } finally {
    startButton.disabled = false;
  }
}
function selectTab(key) {
  activeKey = key;
  for (const entry of entries.values()) {
    const selected = entry.key === key;
    const tab = $(`#tab-${entry.key}`);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(`#panel-${entry.key}`).hidden = !selected;
  }
  entries.get(key).panel?.skinView?.fit();
  if (playing) void routeTo(entries.get(key), ++switchRequest).catch((error2) => say(`Could not switch EQ: ${error2.message}`, "error"));
}
for (const entry of entries.values()) {
  $(`#tab-${entry.key}`).addEventListener("click", () => selectTab(entry.key));
}
$("#tabs").addEventListener("keydown", (event) => {
  const keys = [...entries.keys()];
  const index = keys.indexOf(activeKey);
  const next = event.key === "ArrowRight" ? keys[(index + 1) % keys.length] : event.key === "ArrowLeft" ? keys[(index + keys.length - 1) % keys.length] : event.key === "Home" ? keys[0] : event.key === "End" ? keys.at(-1) : null;
  if (!next) return;
  event.preventDefault();
  $(`#tab-${next}`).focus();
  selectTab(next);
});
startButton.addEventListener("click", () => {
  if (playing) stopNoise();
  else void startNoise();
});
$("#noise-level").addEventListener("input", (event) => {
  const value = Number(event.currentTarget.value);
  $("#noise-level-value").textContent = `${value} dB`;
  if (inputGain) inputGain.gain.setValueAtTime(gainFromDb(value), context.currentTime);
});
$("#output-level").addEventListener("input", (event) => {
  const value = Number(event.currentTarget.value);
  $("#output-level-value").textContent = `${value} dB`;
  if (monitorGain) monitorGain.gain.setValueAtTime(gainFromDb(value), context.currentTime);
});
prepareHost().catch((error2) => {
  startButton.disabled = true;
  say(`Harness setup failed: ${error2.message}`, "error");
});
/*! Bundled license information:

ieee754/index.js:
  (*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> *)

buffer/index.js:
  (*!
   * The buffer module from node.js, for the browser.
   *
   * @author   Feross Aboukhadijeh <https://feross.org>
   * @license  MIT
   *)

safe-buffer/index.js:
  (*! safe-buffer. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> *)

rdf-canonize/lib/MessageDigest-browser.js:
rdf-canonize/lib/Permuter.js:
rdf-canonize/lib/NQuads.js:
rdf-canonize/lib/URDNA2015Sync.js:
  (*!
   * Copyright (c) 2016-2022 Digital Bazaar, Inc. All rights reserved.
   *)
*/
//# sourceMappingURL=jigeq-abc.bundle.js.map
