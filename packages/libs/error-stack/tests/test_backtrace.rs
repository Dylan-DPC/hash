#![cfg(all(feature = "std", nightly))]
#![feature(provide_any, backtrace, backtrace_frames)]

mod common;

#[cfg(all(nightly, feature = "std"))]
use std::error::Error;

use common::*;
use error_stack::Report;

#[test]
fn captured() {
    std::env::set_var("RUST_LIB_BACKTRACE", "1");

    let report = create_report();
    let backtrace = report.backtrace().expect("No backtrace captured");
    assert!(!backtrace.frames().is_empty());
}

#[test]
fn provided() {
    let error = ErrorB::new(10);
    let error_backtrace = error.backtrace().expect("No backtrace captured");
    let error_backtrace_len = error_backtrace.frames().len();
    #[cfg(not(miri))]
    let error_backtrace_string = error_backtrace.to_string();

    let report = Report::new(error);
    let report_backtrace = report.backtrace().expect("No backtrace captured");
    let report_backtrace_len = report_backtrace.frames().len();
    #[cfg(not(miri))]
    let report_backtrace_string = report_backtrace.to_string();

    assert_eq!(error_backtrace_len, report_backtrace_len);
    #[cfg(not(miri))]
    assert_eq!(error_backtrace_string, report_backtrace_string);
}