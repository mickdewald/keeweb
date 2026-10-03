(function (global) {
  var babelHelpers = global.babelHelpers = {};
function _arrayWithHoles(r) {
  if (Array.isArray(r)) return r;
}

function _iterableToArrayLimit(r, l) {
  var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
  if (null != t) {
    var e,
      n,
      i,
      u,
      a = [],
      f = !0,
      o = !1;
    try {
      if (i = (t = t.call(r)).next, 0 === l) {
        if (Object(t) !== t) return;
        f = !1;
      } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0);
    } catch (r) {
      o = !0, n = r;
    } finally {
      try {
        if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return;
      } finally {
        if (o) throw n;
      }
    }
    return a;
  }
}

function _arrayLikeToArray(r, a) {
  (null == a || a > r.length) && (a = r.length);
  for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
  return n;
}

function _unsupportedIterableToArray(r, a) {
  if (r) {
    if ("string" == typeof r) return babelHelpers.arrayLikeToArray(r, a);
    var t = {}.toString.call(r).slice(8, -1);
    return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? babelHelpers.arrayLikeToArray(r, a) : void 0;
  }
}

function _nonIterableRest() {
  throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}

function _slicedToArray(r, e) {
  return babelHelpers.arrayWithHoles(r) || babelHelpers.iterableToArrayLimit(r, e) || babelHelpers.unsupportedIterableToArray(r, e) || babelHelpers.nonIterableRest();
}

function _arrayWithoutHoles(r) {
  if (Array.isArray(r)) return babelHelpers.arrayLikeToArray(r);
}

function _iterableToArray(r) {
  if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r);
}

function _nonIterableSpread() {
  throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}

function _toConsumableArray(r) {
  return babelHelpers.arrayWithoutHoles(r) || babelHelpers.iterableToArray(r) || babelHelpers.unsupportedIterableToArray(r) || babelHelpers.nonIterableSpread();
}

function _toPrimitive(t, r) {
  if ("object" != typeof t || !t) return t;
  var e = t[Symbol.toPrimitive];
  if (void 0 !== e) {
    var i = e.call(t, r || "default");
    if ("object" != typeof i) return i;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return ("string" === r ? String : Number)(t);
}

function _toPropertyKey(t) {
  var i = babelHelpers.toPrimitive(t, "string");
  return "symbol" == typeof i ? i : i + "";
}

function _defineProperty(e, r, t) {
  return (r = babelHelpers.toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
    value: t,
    enumerable: !0,
    configurable: !0,
    writable: !0
  }) : e[r] = t, e;
}

function _typeof(o) {
  "@babel/helpers - typeof";

  return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) {
    return typeof o;
  } : function (o) {
    return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
  }, _typeof(o);
}
babelHelpers.slicedToArray = _slicedToArray;
babelHelpers.arrayWithHoles = _arrayWithHoles;
babelHelpers.iterableToArrayLimit = _iterableToArrayLimit;
babelHelpers.unsupportedIterableToArray = _unsupportedIterableToArray;
babelHelpers.arrayLikeToArray = _arrayLikeToArray;
babelHelpers.nonIterableRest = _nonIterableRest;
babelHelpers.toConsumableArray = _toConsumableArray;
babelHelpers.arrayWithoutHoles = _arrayWithoutHoles;
babelHelpers.iterableToArray = _iterableToArray;
babelHelpers.nonIterableSpread = _nonIterableSpread;
babelHelpers.defineProperty = _defineProperty;
babelHelpers.toPropertyKey = _toPropertyKey;
babelHelpers.toPrimitive = _toPrimitive;
babelHelpers.typeof = _typeof;
})(typeof global === 'undefined' ? self : global);
