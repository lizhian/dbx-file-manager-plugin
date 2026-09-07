use crate::error::{error, Result};
use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, CONTROLS};

const PATH_COMPONENT: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'/')
    .add(b':')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

pub fn path(uri: &str, scheme: &str) -> Result<String> {
    if uri.len() > 16_384 {
        return Err(error("configuration", "URI is too long"));
    }
    let raw = uri.strip_prefix(&format!("{scheme}:/")).ok_or_else(|| {
        error(
            "configuration",
            "URI must use this provider's root-relative scheme",
        )
    })?;
    if raw.starts_with('/') || raw.contains(['?', '#', '\\']) {
        return Err(error(
            "configuration",
            "URI authorities, queries, fragments and backslashes are forbidden",
        ));
    }
    let mut parts = Vec::new();
    let segment_count = raw.split('/').count();
    for (index, segment) in raw.split('/').enumerate() {
        if segment.is_empty() {
            if index == segment_count - 1 {
                continue;
            }
            return Err(error("configuration", "Empty path segments are forbidden"));
        }
        let bytes = segment.as_bytes();
        for i in 0..bytes.len() {
            if bytes[i] == b'%'
                && (i + 2 >= bytes.len()
                    || !bytes[i + 1].is_ascii_hexdigit()
                    || !bytes[i + 2].is_ascii_hexdigit())
            {
                return Err(error("configuration", "Invalid URI percent encoding"));
            }
        }
        let decoded = percent_decode_str(segment)
            .decode_utf8()
            .map_err(|_| error("configuration", "URI is not valid UTF-8"))?;
        if decoded == "."
            || decoded == ".."
            || decoded.contains(['/', '\\'])
            || decoded.chars().any(char::is_control)
        {
            return Err(error(
                "configuration",
                "URI traversal and encoded separators are forbidden",
            ));
        }
        // A literal percent is safe; reject nested escapes that could be interpreted by a second decoder.
        let mut nested = decoded.to_string();
        for _ in 0..segment.len() {
            let next = percent_decode_str(&nested).decode_utf8_lossy().into_owned();
            if next == nested {
                break;
            }
            if next == "."
                || next == ".."
                || next.contains(['/', '\\'])
                || next.chars().any(char::is_control)
            {
                return Err(error("configuration", "Nested URI traversal is forbidden"));
            }
            nested = next;
        }
        parts.push(decoded.into_owned());
    }
    let mut result = parts.join("/");
    if !result.is_empty() && raw.ends_with('/') {
        result.push('/');
    }
    Ok(result)
}

pub fn non_root(path: &str) -> Result<&str> {
    if path.trim_matches('/').is_empty() {
        Err(error(
            "configuration",
            "The configured root cannot be mutated",
        ))
    } else {
        Ok(path.trim_end_matches('/'))
    }
}

pub fn uri(scheme: &str, path: &str) -> String {
    format!(
        "{scheme}:/{}",
        path.split('/')
            .map(|s| utf8_percent_encode(s, PATH_COMPONENT).to_string())
            .collect::<Vec<_>>()
            .join("/")
    )
}
