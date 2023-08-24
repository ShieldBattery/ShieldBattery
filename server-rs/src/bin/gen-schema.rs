use color_eyre::eyre;
use color_eyre::eyre::WrapErr;
use server::schema::write_schema;

fn main() -> eyre::Result<()> {
    println!("Writing schema to file...");
    write_schema("../schema.graphql").wrap_err("Failed to write GraphQL schema")?;
    println!("Completed!");

    Ok(())
}
