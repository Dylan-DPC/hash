use std::ops::Deref;

use analyzer::Analyzer;
pub use output::{AnalysisOutput, AnalysisSingleOutput};
use serde_json::Value;

pub use self::config::AnalysisOutputConfig;
pub use super::super::*;
use crate::{
    datastore::table::state::ReadState, experiment::SimPackageArgs, proto::ExperimentRunTrait,
};

#[macro_use]
mod macros;
mod analyzer;
mod config;
mod index_iter;
mod output;
mod validation;
mod value_iter;

pub enum Task {}

pub struct Creator {}

impl PackageCreator for Creator {
    #[tracing::instrument(skip_all)]
    fn new(_experiment_config: &Arc<ExperimentConfig>) -> Result<Box<dyn PackageCreator>> {
        Ok(Box::new(Creator {}))
    }

    #[tracing::instrument(skip_all)]
    fn create(
        &self,
        config: &Arc<SimRunConfig>,
        _comms: PackageComms,
        accessor: FieldSpecMapAccessor,
    ) -> Result<Box<dyn Package>> {
        // TODO, look at reworking signatures and package creation to make ownership clearer and
        // make this unnecessary
        let analysis_src = get_analysis_source(&config.exp.run.base().project_base.packages)?;
        let analyzer = Analyzer::from_analysis_source(
            &analysis_src,
            &config.sim.store.agent_schema,
            &accessor,
        )?;

        Ok(Box::new(Analysis { analyzer }))
    }

    #[tracing::instrument(skip_all)]
    fn persistence_config(&self, config: &ExperimentConfig, _globals: &Globals) -> Result<Value> {
        let config = AnalysisOutputConfig::new(config)?;
        Ok(serde_json::to_value(config)?)
    }
}

impl GetWorkerExpStartMsg for Creator {
    #[tracing::instrument(skip_all)]
    fn get_worker_exp_start_msg(&self) -> Result<Value> {
        Ok(Value::Null)
    }
}

struct Analysis {
    analyzer: Analyzer,
}

impl MaybeCpuBound for Analysis {
    #[tracing::instrument(skip_all)]
    fn cpu_bound(&self) -> bool {
        true
    }
}

impl GetWorkerSimStartMsg for Analysis {
    #[tracing::instrument(skip_all)]
    fn get_worker_sim_start_msg(&self) -> Result<Value> {
        Ok(Value::Null)
    }
}

#[async_trait]
impl Package for Analysis {
    #[tracing::instrument(skip_all)]
    async fn run(&mut self, state: Arc<State>, _context: Arc<Context>) -> Result<Output> {
        // TODO: use filtering to avoid exposing hidden values to users
        let read = state.agent_pool().read_batches()?;
        // TODO: propagate Deref trait bound through run
        let dynamic_pool = read.iter().map(|v| v.deref()).collect::<Vec<_>>();
        self.analyzer.run(&dynamic_pool, state.num_agents())?;
        // TODO: why doesn't into work?
        Ok(Output::AnalysisOutput(
            self.analyzer.get_latest_output_set(),
        ))
    }
}

pub(self) fn get_analysis_source(sim_packages: &[SimPackageArgs]) -> Result<String> {
    for args in sim_packages.iter() {
        if args.name.as_str() == "analysis" {
            // We currently assume that every analysis source is identical within the
            // simulation runs of an experiment run.
            if let Some(src) = args.data.as_str() {
                return Ok(src.to_string());
            } else {
                return Err(Error::from("Analysis source must be a string"));
            }
        }
    }
    Err(Error::from("Did not find analysis source"))
}
