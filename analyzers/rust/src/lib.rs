//! Planisphere's Rust analyzer: reads Rust source and builds the artifact every
//! producer writes. Nothing is compiled and nothing is fetched.

mod analyze;
pub mod graph;
mod manifest;
mod walk;

pub use analyze::analyze;
pub use graph::{encode, Edge, Graph, Member, Node};
