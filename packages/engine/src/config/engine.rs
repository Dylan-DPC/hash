use crate::types::WorkerIndex;

// Configuration specific to a single simulation engine
#[derive(Debug, Clone)]
pub struct Config {
    pub worker_allocation: WorkerAllocation,
    pub num_workers: usize,
}

pub type WorkerAllocation = Vec<Worker>;

#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub struct Worker(WorkerIndex);

impl Worker {
    #[tracing::instrument(skip_all)]
    pub fn new(index: WorkerIndex) -> Worker {
        Worker(index)
    }

    #[tracing::instrument(skip_all)]
    pub fn index(&self) -> WorkerIndex {
        self.0
    }
}
