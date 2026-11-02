#![forbid(unsafe_code)]

#[allow(dead_code)]
#[path = "main.rs"]
mod participant;

fn main() {
    std::process::exit(participant::run_dkg_input_validator_cli());
}
