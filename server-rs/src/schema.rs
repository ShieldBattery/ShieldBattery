use std::fs::File;
use std::io::Write;
use std::path::Path;

use async_graphql::{EmptySubscription, MergedObject, Schema, SchemaBuilder};
use tokio::io;

use crate::users::{UsersMutation, UsersQuery};

pub type SbSchema = Schema<Query, Mutation, EmptySubscription>;

#[derive(MergedObject, Default)]
pub struct Query(UsersQuery);

#[derive(MergedObject, Default)]
pub struct Mutation(UsersMutation);

pub fn build_schema() -> SchemaBuilder<Query, Mutation, EmptySubscription> {
    Schema::build(Query::default(), Mutation::default(), EmptySubscription)
}

/// Wrties the GraphQL schema to an SDL file at the given path.
pub fn write_schema<P>(path: P) -> io::Result<()>
where
    P: AsRef<Path>,
{
    let schema = build_schema().finish();
    let mut file = File::create(path)?;
    file.write_all(schema.sdl().as_bytes())
}
