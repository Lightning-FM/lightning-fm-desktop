# Desktop component refinements

- Inspect this repository's package and `src-tauri/Cargo.toml` for commands.
  Check frontend builds and relevant Rust tests separately; bundle signing and
  release publication are separate external actions.
- Avoid production `unwrap()` and blocking the UI thread. Use Tauri events for
  backend updates and the macOS Keychain for persistent private keys.
- Keep tests independent of live credentials and network services where possible.
- The stamped design README describes how to refresh canonical design inputs;
  follow it and the local tokens instead of modifying generated design copies.
