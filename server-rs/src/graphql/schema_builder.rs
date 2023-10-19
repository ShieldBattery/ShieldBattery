use async_graphql::SchemaBuilder;

/// A trait that allows for splitting initialization of GraphQL schema data (e.g. loaders,
/// repositories, etc.) into modules.
pub trait SchemaBuilderModule {
    fn apply<Q, M, S>(&self, builder: SchemaBuilder<Q, M, S>) -> SchemaBuilder<Q, M, S>;
}

pub trait SchemaBuilderModuleExt {
    fn module<M: SchemaBuilderModule>(self, module: M) -> Self
    where
        Self: Sized;
}

impl<Q, M, S> SchemaBuilderModuleExt for SchemaBuilder<Q, M, S> {
    fn module<Module: SchemaBuilderModule>(self, module: Module) -> Self
    where
        Self: Sized,
    {
        module.apply(self)
    }
}
