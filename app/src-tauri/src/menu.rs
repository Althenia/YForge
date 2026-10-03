use std::collections::HashMap;

use tauri::menu::{
    CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use yforge_core::ErrorPayload;

pub const MENU_ACTION_EVENT: &str = "menu-action";

const SHORTCUT_REGISTRY: &str = include_str!("../../src/state/shortcuts.ts");

#[derive(Clone, Copy)]
enum Native {
    About,
    Services,
    Hide,
    HideOthers,
    ShowAll,
    Quit,
    Cut,
    Copy,
    Paste,
    SelectAll,
    FullScreen,
    Minimize,
    Zoom,
    BringAllToFront,
}

#[derive(Clone, Copy)]
enum Entry {
    Item {
        id: &'static str,
        title: &'static str,
        shortcut: Option<&'static str>,
    },
    Check {
        id: &'static str,
        title: &'static str,
    },
    Native(Native),
    Menu(&'static str, &'static [Entry]),
    Separator,
}

const fn item(id: &'static str, title: &'static str, shortcut: Option<&'static str>) -> Entry {
    Entry::Item {
        id,
        title,
        shortcut,
    }
}

const YFORGE: &[Entry] = &[
    Entry::Native(Native::About),
    item("app.release_notes", "View Release Notes", None),
    item("update.check", "Check for Update…", None),
    Entry::Separator,
    item("settings.open", "Settings…", Some("settings")),
    Entry::Separator,
    Entry::Native(Native::Services),
    Entry::Separator,
    Entry::Native(Native::Hide),
    Entry::Native(Native::HideOthers),
    Entry::Native(Native::ShowAll),
    Entry::Separator,
    Entry::Native(Native::Quit),
];

const FILE: &[Entry] = &[
    item("tab.new", "New Tab", Some("newTab")),
    item(
        "repository.open",
        "Open Repository…",
        Some("openRepository"),
    ),
    item("repository.clone", "Clone Repository…", None),
    item("repository.create", "Create Repository…", None),
    Entry::Separator,
    item("launchpad.open", "Launchpad", None),
    Entry::Separator,
    item("tab.close", "Close Tab", Some("closeTab")),
    item("tab.reopen", "Reopen Closed Tab", Some("reopenClosedTab")),
];

const EDIT: &[Entry] = &[
    item("edit.undo", "Undo", Some("undo")),
    item("edit.redo", "Redo", Some("redo")),
    Entry::Separator,
    Entry::Native(Native::Cut),
    Entry::Native(Native::Copy),
    Entry::Native(Native::Paste),
    Entry::Native(Native::SelectAll),
    Entry::Separator,
    item("search.commits", "Find", Some("search")),
    item("palette.open", "Command Palette", Some("palette")),
];

const THEME: &[Entry] = &[
    Entry::Check {
        id: "theme.light",
        title: "Light",
    },
    Entry::Check {
        id: "theme.dark",
        title: "Dark",
    },
    Entry::Check {
        id: "theme.system",
        title: "System",
    },
];

const DENSITY: &[Entry] = &[
    Entry::Check {
        id: "density.default",
        title: "Default",
    },
    Entry::Check {
        id: "density.compact",
        title: "Compact",
    },
];

const VIEW: &[Entry] = &[
    Entry::Menu("Theme", THEME),
    Entry::Menu("Density", DENSITY),
    item("head.reveal", "Reveal HEAD", Some("revealHead")),
    Entry::Separator,
    item("zoom.in", "Zoom In", Some("zoomIn")),
    item("zoom.out", "Zoom Out", Some("zoomOut")),
    item("zoom.reset", "Actual Size", Some("zoomReset")),
    Entry::Separator,
    item("view.sidebar", "Toggle Sidebar", Some("toggleSidebar")),
    item(
        "view.inspector",
        "Toggle Inspector",
        Some("toggleInspector"),
    ),
    Entry::Separator,
    Entry::Native(Native::FullScreen),
];

const REPOSITORY: &[Entry] = &[
    item(
        "repository.search",
        "Open Repository Search",
        Some("openRepoSearch"),
    ),
    item(
        "open.editor",
        "Open in External Editor",
        Some("openInEditor"),
    ),
    Entry::Separator,
    item("sync.fetch", "Fetch", Some("fetch")),
    item("sync.pull", "Pull", Some("pull")),
    item("sync.push", "Push", Some("push")),
    Entry::Separator,
    item("branch.create", "Create Branch…", Some("createBranch")),
    item("stash.push", "Stash…", Some("stash")),
    Entry::Separator,
    item("undo", "Undo Last Action", None),
    item("redo", "Redo Last Action", None),
];

const WINDOW: &[Entry] = &[
    Entry::Native(Native::Minimize),
    Entry::Native(Native::Zoom),
    Entry::Separator,
    item("tab.next", "Show Next Tab", Some("nextTab")),
    item("tab.previous", "Show Previous Tab", Some("previousTab")),
    Entry::Separator,
    Entry::Native(Native::BringAllToFront),
];

const HELP: &[Entry] = &[
    item("help.docs", "YForge Help", None),
    item("help.shortcuts", "Keyboard Shortcuts", None),
    item("help.report_issue", "Report an Issue", None),
];

const MENUS: &[(&str, &[Entry])] = &[
    ("YForge", YFORGE),
    ("File", FILE),
    ("Edit", EDIT),
    ("View", VIEW),
    ("Repository", REPOSITORY),
    ("Window", WINDOW),
    ("Help", HELP),
];

pub fn registry_shortcut(key: &str) -> Option<String> {
    SHORTCUT_REGISTRY.lines().find_map(|line| {
        let (name, value) = line.trim().split_once(':')?;
        if name != key {
            return None;
        }
        value
            .trim()
            .trim_end_matches(',')
            .strip_prefix('"')?
            .strip_suffix('"')
            .map(|glyphs| glyphs.replace("\\\\", "\\"))
    })
}

pub fn accelerator(glyphs: &str) -> Option<String> {
    let mut parts = Vec::new();
    let mut chars = glyphs.chars().peekable();
    while let Some(glyph) = chars.next() {
        if chars.peek().is_none() {
            parts.push(match glyph {
                '↵' => "Enter".to_owned(),
                '⇥' => "Tab".to_owned(),
                other if other.is_ascii_alphanumeric() || ",=-\\".contains(other) => {
                    other.to_ascii_uppercase().to_string()
                }
                _ => return None,
            });
        } else {
            parts.push(
                match glyph {
                    '⌘' => "CmdOrCtrl",
                    '⇧' => "Shift",
                    '⌃' => "Ctrl",
                    '⌥' => "Alt",
                    _ => return None,
                }
                .to_owned(),
            );
        }
    }
    (!parts.is_empty()).then(|| parts.join("+"))
}

fn shortcut_of(key: Option<&str>) -> tauri::Result<Option<String>> {
    match key {
        None => Ok(None),
        Some(key) => registry_shortcut(key)
            .and_then(|glyphs| accelerator(&glyphs))
            .map(Some)
            .ok_or_else(|| {
                tauri::Error::from(std::io::Error::other(format!(
                    "the menu names shortcut {key}, which the shortcut registry does not hold"
                )))
            }),
    }
}

pub fn custom_ids() -> Vec<&'static str> {
    fn collect(entries: &'static [Entry], ids: &mut Vec<&'static str>) {
        for entry in entries {
            match entry {
                Entry::Item { id, .. } | Entry::Check { id, .. } => ids.push(id),
                Entry::Menu(_, inner) => collect(inner, ids),
                Entry::Native(_) | Entry::Separator => {}
            }
        }
    }
    let mut ids = Vec::new();
    for (_, entries) in MENUS {
        collect(entries, &mut ids);
    }
    ids
}

pub fn shortcut_keys() -> Vec<&'static str> {
    fn collect(entries: &'static [Entry], keys: &mut Vec<&'static str>) {
        for entry in entries {
            match entry {
                Entry::Item {
                    shortcut: Some(key),
                    ..
                } => keys.push(key),
                Entry::Menu(_, inner) => collect(inner, keys),
                _ => {}
            }
        }
    }
    let mut keys = Vec::new();
    for (_, entries) in MENUS {
        collect(entries, &mut keys);
    }
    keys
}

pub struct MenuItems<R: Runtime>(HashMap<&'static str, MenuItemKind<R>>);

fn native_title(kind: Native) -> Option<&'static str> {
    match kind {
        Native::About => Some("About YForge"),
        Native::Zoom => Some("Zoom"),
        Native::FullScreen => Some("Enter Full Screen"),
        _ => None,
    }
}

fn native<R: Runtime>(app: &AppHandle<R>, kind: Native) -> tauri::Result<PredefinedMenuItem<R>> {
    match kind {
        Native::About => PredefinedMenuItem::about(app, native_title(kind), None),
        Native::Services => PredefinedMenuItem::services(app, None),
        Native::Hide => PredefinedMenuItem::hide(app, None),
        Native::HideOthers => PredefinedMenuItem::hide_others(app, None),
        Native::ShowAll => PredefinedMenuItem::show_all(app, None),
        Native::Quit => PredefinedMenuItem::quit(app, None),
        Native::Cut => PredefinedMenuItem::cut(app, None),
        Native::Copy => PredefinedMenuItem::copy(app, None),
        Native::Paste => PredefinedMenuItem::paste(app, None),
        Native::SelectAll => PredefinedMenuItem::select_all(app, None),
        Native::FullScreen => PredefinedMenuItem::fullscreen(app, native_title(kind)),
        Native::Minimize => PredefinedMenuItem::minimize(app, None),
        Native::Zoom => PredefinedMenuItem::maximize(app, native_title(kind)),
        Native::BringAllToFront => PredefinedMenuItem::bring_all_to_front(app, None),
    }
}

fn fill<R: Runtime>(
    app: &AppHandle<R>,
    submenu: &Submenu<R>,
    entries: &'static [Entry],
    items: &mut HashMap<&'static str, MenuItemKind<R>>,
) -> tauri::Result<()> {
    for entry in entries {
        match *entry {
            Entry::Separator => submenu.append(&PredefinedMenuItem::separator(app)?)?,
            Entry::Native(kind) => submenu.append(&native(app, kind)?)?,
            Entry::Item {
                id,
                title,
                shortcut,
            } => {
                let created =
                    MenuItem::with_id(app, id, title, true, shortcut_of(shortcut)?.as_deref())?;
                submenu.append(&created)?;
                items.insert(id, MenuItemKind::MenuItem(created));
            }
            Entry::Check { id, title } => {
                let created = CheckMenuItem::with_id(app, id, title, true, false, None::<&str>)?;
                submenu.append(&created)?;
                items.insert(id, MenuItemKind::Check(created));
            }
            Entry::Menu(title, inner) => {
                let nested = SubmenuBuilder::new(app, title).build()?;
                fill(app, &nested, inner, items)?;
                submenu.append(&nested)?;
            }
        }
    }
    Ok(())
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<(Menu<R>, MenuItems<R>)> {
    let menu = Menu::new(app)?;
    let mut items = HashMap::new();
    for (title, entries) in MENUS {
        let submenu = SubmenuBuilder::new(app, *title).build()?;
        fill(app, &submenu, entries, &mut items)?;
        menu.append(&submenu)?;
        #[cfg(target_os = "macos")]
        match *title {
            "Window" => submenu.set_as_windows_menu_for_nsapp()?,
            "Help" => submenu.set_as_help_menu_for_nsapp()?,
            _ => {}
        }
    }
    Ok((menu, MenuItems(items)))
}

pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let (menu, items) = build(app)?;
    app.set_menu(menu)?;
    app.manage(items);
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        if let Some(known) = custom_ids().into_iter().find(|known| *known == id) {
            if let Err(error) = app.emit(MENU_ACTION_EVENT, known) {
                log::warn!("could not deliver menu action {known}: {error}");
            }
        }
    });
    Ok(())
}

pub fn apply<R: Runtime>(
    items: &MenuItems<R>,
    enabled: &HashMap<String, bool>,
    checked: &HashMap<String, bool>,
) -> tauri::Result<()> {
    for (id, kind) in &items.0 {
        let enable = enabled.get(*id).copied();
        match kind {
            MenuItemKind::MenuItem(entry) => {
                if let Some(on) = enable {
                    entry.set_enabled(on)?;
                }
            }
            MenuItemKind::Check(entry) => {
                if let Some(on) = enable {
                    entry.set_enabled(on)?;
                }
                if let Some(on) = checked.get(*id) {
                    entry.set_checked(*on)?;
                }
            }
            _ => {}
        }
    }
    Ok(())
}

#[tauri::command]
pub fn menu_update<R: Runtime>(
    app: AppHandle<R>,
    enabled: HashMap<String, bool>,
    checked: HashMap<String, bool>,
) -> Result<(), ErrorPayload> {
    match app.try_state::<MenuItems<R>>() {
        Some(items) => apply(&items, &enabled, &checked)
            .map_err(|error| ErrorPayload::internal(error.to_string())),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn the_shortcut_registry_is_read_from_the_frontend_source() {
        assert_eq!(registry_shortcut("reopenClosedTab").as_deref(), Some("⌘⇧T"));
        assert_eq!(registry_shortcut("nextTab").as_deref(), Some("⌃⇥"));
        assert_eq!(registry_shortcut("settings").as_deref(), Some("⌘,"));
        assert_eq!(registry_shortcut("toggleSidebar").as_deref(), Some("⌘\\"));
        assert_eq!(registry_shortcut("nothing"), None);
    }

    #[test]
    fn glyphs_become_menu_accelerators() {
        assert_eq!(accelerator("⌘⇧T").as_deref(), Some("CmdOrCtrl+Shift+T"));
        assert_eq!(accelerator("⌃⇧⇥").as_deref(), Some("Ctrl+Shift+Tab"));
        assert_eq!(accelerator("⌘,").as_deref(), Some("CmdOrCtrl+,"));
        assert_eq!(accelerator("⌘↵").as_deref(), Some("CmdOrCtrl+Enter"));
        assert_eq!(accelerator("⌘=").as_deref(), Some("CmdOrCtrl+="));
        assert_eq!(accelerator("⌘-").as_deref(), Some("CmdOrCtrl+-"));
        assert_eq!(accelerator("⌘0").as_deref(), Some("CmdOrCtrl+0"));
        assert_eq!(accelerator("⌥⌘\\").as_deref(), Some("Alt+CmdOrCtrl+\\"));
        assert_eq!(accelerator("⌘?"), None);
    }

    #[test]
    fn every_shortcut_the_menu_names_is_in_the_registry_with_a_valid_accelerator() {
        for key in shortcut_keys() {
            let glyphs =
                registry_shortcut(key).unwrap_or_else(|| panic!("{key} is not registered"));
            assert!(accelerator(&glyphs).is_some(), "{key} = {glyphs}");
        }
    }

    #[test]
    fn menu_item_ids_are_unique() {
        let ids = custom_ids();

        assert_eq!(ids.iter().collect::<HashSet<_>>().len(), ids.len());
    }

    #[test]
    fn the_menu_bar_has_the_seven_menus_in_order() {
        let titles: Vec<&str> = MENUS.iter().map(|(title, _)| *title).collect();

        assert_eq!(
            titles,
            [
                "YForge",
                "File",
                "Edit",
                "View",
                "Repository",
                "Window",
                "Help"
            ]
        );
    }

    #[test]
    fn the_native_items_the_design_titles_carry_those_titles() {
        assert_eq!(native_title(Native::FullScreen), Some("Enter Full Screen"));
        assert_eq!(native_title(Native::About), Some("About YForge"));
        assert_eq!(native_title(Native::Zoom), Some("Zoom"));
        assert_eq!(native_title(Native::Quit), None);
    }

    #[test]
    fn the_menu_carries_the_items_the_design_names_with_the_shortcuts_it_gives_them() {
        let with_shortcut: Vec<(&str, Option<&str>)> = MENUS
            .iter()
            .flat_map(|(_, entries)| entries.iter())
            .filter_map(|entry| match entry {
                Entry::Item { id, shortcut, .. } => Some((*id, *shortcut)),
                _ => None,
            })
            .collect();

        for (id, shortcut) in [
            ("update.check", None),
            ("settings.open", Some("settings")),
            ("tab.new", Some("newTab")),
            ("repository.open", Some("openRepository")),
            ("tab.close", Some("closeTab")),
            ("tab.reopen", Some("reopenClosedTab")),
            ("edit.undo", Some("undo")),
            ("edit.redo", Some("redo")),
            ("search.commits", Some("search")),
            ("palette.open", Some("palette")),
            ("head.reveal", Some("revealHead")),
            ("sync.fetch", Some("fetch")),
            ("sync.pull", Some("pull")),
            ("sync.push", Some("push")),
            ("branch.create", Some("createBranch")),
            ("stash.push", Some("stash")),
            ("tab.next", Some("nextTab")),
            ("tab.previous", Some("previousTab")),
            ("zoom.in", Some("zoomIn")),
            ("zoom.out", Some("zoomOut")),
            ("zoom.reset", Some("zoomReset")),
            ("view.sidebar", Some("toggleSidebar")),
            ("view.inspector", Some("toggleInspector")),
            ("repository.search", Some("openRepoSearch")),
            ("open.editor", Some("openInEditor")),
            ("undo", None),
            ("redo", None),
        ] {
            assert!(with_shortcut.contains(&(id, shortcut)), "{id}");
        }
    }
}
