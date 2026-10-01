use yforge_core::RepoRef;
use yforge_platform::parse_remote;

fn parsed(url: &str) -> Option<(String, String, String)> {
    parse_remote(url).map(|(host, RepoRef { owner, repo })| (host, owner, repo))
}

fn expected(host: &str, owner: &str, repo: &str) -> Option<(String, String, String)> {
    Some((host.to_owned(), owner.to_owned(), repo.to_owned()))
}

#[test]
fn every_url_form_resolves_to_host_owner_and_repo() {
    for url in [
        "https://github.com/owner/widget.git",
        "http://github.com/owner/widget.git",
        "git@github.com:owner/widget.git",
        "ssh://git@github.com/owner/widget.git",
        "git://github.com/owner/widget.git",
    ] {
        assert_eq!(
            parsed(url),
            expected("github.com", "owner", "widget"),
            "{url}"
        );
    }
}

#[test]
fn the_git_suffix_is_optional_and_the_host_is_lowercased() {
    assert_eq!(
        parsed("https://GitHub.COM/owner/widget"),
        expected("github.com", "owner", "widget")
    );
    assert_eq!(
        parsed("GIT@GitLab.Example.com:owner/widget.git"),
        expected("gitlab.example.com", "owner", "widget")
    );
}

#[test]
fn credentials_and_ports_are_handled_per_transport() {
    assert_eq!(
        parsed("https://user:secret@host.example:8443/owner/widget.git"),
        expected("host.example:8443", "owner", "widget")
    );
    assert_eq!(
        parsed("ssh://git@host.example:2222/owner/widget.git"),
        expected("host.example", "owner", "widget")
    );
}

#[test]
fn nested_groups_keep_the_whole_namespace_as_the_owner() {
    assert_eq!(
        parsed("git@gitlab.com:group/sub/widget.git"),
        expected("gitlab.com", "group/sub", "widget")
    );
}

#[test]
fn data_center_scm_urls_drop_the_scm_segment() {
    for url in [
        "https://bitbucket.example.com/scm/PROJ/repo.git",
        "https://user@bitbucket.example.com/scm/PROJ/repo.git",
        "ssh://git@bitbucket.example.com:7999/scm/PROJ/repo.git",
    ] {
        assert_eq!(
            parsed(url),
            expected("bitbucket.example.com", "PROJ", "repo"),
            "{url}"
        );
    }
    assert_eq!(
        parsed("https://bitbucket.example.com/scm/~alice/repo.git"),
        expected("bitbucket.example.com", "~alice", "repo")
    );
}

#[test]
fn data_center_browse_urls_resolve_to_project_and_repo() {
    for url in [
        "https://bitbucket.example.com/projects/PROJ/repos/repo",
        "https://bitbucket.example.com/projects/PROJ/repos/repo/browse",
        "https://bitbucket.example.com/projects/PROJ/repos/repo/pull-requests/4/overview",
    ] {
        assert_eq!(
            parsed(url),
            expected("bitbucket.example.com", "PROJ", "repo"),
            "{url}"
        );
    }
}

#[test]
fn a_scm_segment_that_is_not_leading_stays_part_of_the_namespace() {
    assert_eq!(
        parsed("git@gitlab.com:group/scm/widget.git"),
        expected("gitlab.com", "group/scm", "widget")
    );
}

#[test]
fn local_and_malformed_remotes_are_rejected() {
    for url in [
        "",
        "/srv/git/widget.git",
        "../widget.git",
        "./widget",
        "widget.git",
        "C:widget",
        "file:///srv/git/widget.git",
        "https://github.com/widget.git",
        "https://github.com/",
        "https:///owner/widget.git",
        "git@github.com:widget.git",
        "https://bitbucket.example.com/scm/repo.git",
        "https://bitbucket.example.com/scm/",
    ] {
        assert_eq!(parse_remote(url), None, "{url}");
    }
}
