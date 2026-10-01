use yforge_core::UpdateCheck;

#[test]
fn no_newer_release_is_reported_as_up_to_date_with_the_running_version() {
    assert_eq!(
        UpdateCheck::from_release("0.1.0", None),
        UpdateCheck::UpToDate {
            version: "0.1.0".to_owned()
        }
    );
}

#[test]
fn a_newer_release_carries_its_version_and_notes_beside_the_running_version() {
    assert_eq!(
        UpdateCheck::from_release("0.1.0", Some(("0.2.0", Some("- Saved tab groups")))),
        UpdateCheck::Available {
            current: "0.1.0".to_owned(),
            version: "0.2.0".to_owned(),
            notes: "- Saved tab groups".to_owned()
        }
    );
}

#[test]
fn a_release_without_notes_has_empty_notes() {
    assert_eq!(
        UpdateCheck::from_release("0.1.0", Some(("0.2.0", None))),
        UpdateCheck::Available {
            current: "0.1.0".to_owned(),
            version: "0.2.0".to_owned(),
            notes: String::new()
        }
    );
}

#[test]
fn the_update_check_serializes_with_a_kind_tag() {
    let value = serde_json::to_value(UpdateCheck::UpToDate {
        version: "0.1.0".to_owned(),
    })
    .unwrap();

    assert_eq!(
        value,
        serde_json::json!({ "kind": "up_to_date", "version": "0.1.0" })
    );
}
