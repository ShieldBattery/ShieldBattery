use clap::Parser;
use color_eyre::eyre::WrapErr;
use color_eyre::eyre::{self, eyre};
use server::schema::write_schema;
use std::fs;
use std::path::Path;

#[derive(Parser, Debug)]
#[clap(author, about = "Generate GraphQL schema")]
struct Args {
    /// Exit with code 1 if the schema file has been updated
    #[clap(long)]
    fail_on_update: bool,

    /// Path to write schema file to
    #[clap(default_value = "../schema.graphql")]
    path: String,
}

fn main() -> eyre::Result<()> {
    color_eyre::install()?;
    let args = Args::parse();
    let path = Path::new(&args.path);

    // Read the current file if it exists
    let old_content = if path.exists() {
        Some(fs::read_to_string(path).wrap_err("Failed to read existing schema file")?)
    } else {
        None
    };

    eprintln!("Writing schema to file...");
    write_schema(&args.path).wrap_err("Failed to write GraphQL schema")?;
    eprintln!("Completed!");

    if args.fail_on_update {
        // Read the new content
        let new_content =
            fs::read_to_string(path).wrap_err("Failed to read updated schema file")?;

        // Check if content has changed
        let was_updated = match old_content {
            Some(old) => old != new_content,
            None => true, // If file didn't exist before, it was "updated"
        };

        if was_updated {
            return Err(eyre!("Schema was updated"));
        }
    }

    Ok(())
}
