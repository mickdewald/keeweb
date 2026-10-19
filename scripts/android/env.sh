#!/usr/bin/env bash
# scripts/android/env.sh: select JDK 21 for Android builds (Capacitor 8 needs it). Source this file.
_is_jdk21() { [ -x "$1/bin/java" ] && "$1/bin/java" -version 2>&1 | grep -q 'version "21\.'; }
_jdk21="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
if ! _is_jdk21 "$_jdk21" && command -v brew >/dev/null 2>&1; then
    _jdk21="$(brew --prefix openjdk@21 2>/dev/null || true)/libexec/openjdk.jdk/Contents/Home"
fi
if ! _is_jdk21 "$_jdk21"; then
    echo "JDK 21 not found: install it (brew install openjdk@21) and retry" >&2
    unset -f _is_jdk21
    return 1 2>/dev/null || exit 1
fi
export JAVA_HOME="$_jdk21"
export PATH="$JAVA_HOME/bin:$PATH"
unset _jdk21
unset -f _is_jdk21
