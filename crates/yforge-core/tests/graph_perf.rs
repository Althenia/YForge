use std::fmt::Write as _;
use std::io::Write as _;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use tempfile::TempDir;
use yforge_core::{graph_page, NodeKind};

const PAGE: usize = 200;
const SPINE_SPAN: usize = 12;
const BRANCH_LENGTH: usize = 3;
const LONG_LIVED_EVERY: usize = 1_000;
const FIRST_COMMIT_TIME: i64 = 1_700_000_000;

fn git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

struct Stream {
    text: String,
    marks: usize,
}

impl Stream {
    fn commit(&mut self, branch: &str, links: &[usize]) -> usize {
        self.marks += 1;
        let mark = self.marks;
        let time = FIRST_COMMIT_TIME + i64::try_from(mark).expect("fits");
        let message = format!("Commit {mark}");
        write!(
            self.text,
            "commit refs/heads/{branch}\nmark :{mark}\ncommitter Yui Lin <yui@example.test> {time} +0000\ndata {}\n{message}\n",
            message.len()
        )
        .expect("write to string");
        for (position, link) in links.iter().enumerate() {
            let keyword = if position == 0 { "from" } else { "merge" };
            writeln!(self.text, "{keyword} :{link}").expect("write to string");
        }
        self.text.push('\n');
        mark
    }
}

fn history_stream(commits: usize) -> String {
    let mut stream = Stream {
        text: String::new(),
        marks: 0,
    };
    let mut spine = stream.commit("main", &[]);
    let mut generation = 0;
    while stream.marks < commits {
        for _ in 0..SPINE_SPAN {
            spine = stream.commit("main", &[spine]);
        }
        generation += 1;
        let branch = format!("topic-{generation}");
        let mut tip = spine;
        for _ in 0..BRANCH_LENGTH {
            tip = stream.commit(&branch, &[tip]);
        }
        if generation % LONG_LIVED_EVERY != 0 {
            spine = stream.commit("main", &[spine, tip]);
        }
    }
    stream.text
}

fn generate(commits: usize) -> TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    git(dir.path(), &["init", "-q", "-b", "main"]);
    let mut importer = Command::new("git")
        .arg("-C")
        .arg(dir.path())
        .args(["fast-import", "--quiet"])
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .stdin(Stdio::piped())
        .spawn()
        .expect("fast-import starts");
    importer
        .stdin
        .take()
        .expect("stdin")
        .write_all(history_stream(commits).as_bytes())
        .expect("stream written");
    assert!(importer.wait().expect("fast-import ends").success());
    git(dir.path(), &["checkout", "-q", "main"]);
    dir
}

fn first_page_within(commits: usize, limit: Duration) {
    let repo = generate(commits);

    let started = Instant::now();
    let page = graph_page(repo.path(), 0, PAGE).unwrap();
    let elapsed = started.elapsed();

    println!("graph first page, {commits} commits: {elapsed:?} (limit {limit:?})");
    assert!(page.total as usize >= commits);
    assert_eq!(page.rows.len(), PAGE);
    assert!(page.rows.iter().any(|row| row.kind == NodeKind::Merge));
    assert!(page.rows.iter().any(|row| row.column > 0));
    assert!(elapsed < limit, "{commits} commits took {elapsed:?}");

    let started = Instant::now();
    let deep = graph_page(repo.path(), commits / 2, PAGE).unwrap();
    println!(
        "graph mid-history page, {commits} commits: {:?}",
        started.elapsed()
    );
    assert_eq!(deep.rows.len(), PAGE);
}

#[test]
#[ignore = "run in release mode: cargo test --release -p yforge-core -- --ignored"]
fn first_graph_page_of_a_10k_commit_history_renders_in_under_one_second() {
    first_page_within(10_000, Duration::from_secs(1));
}

#[test]
#[ignore = "run in release mode: cargo test --release -p yforge-core -- --ignored"]
fn first_graph_page_of_a_100k_commit_history_renders_in_under_three_seconds() {
    first_page_within(100_000, Duration::from_secs(3));
}
