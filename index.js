const { Transformer, gql } = require("graphql-transformer-core");

/**
 * A custom `amplify cli` transformer that creates dependencies across
 * table definitions to allow at most 10 at a time to concurrently create
 * which is the current aws limit. This handles migrated resources as well
 * which are hoisted int to the root stack
 */
class CapbaseAmplifyAuthTransformer extends Transformer {
  /**
   * There isn't really a directive associated with this transformer because
   * it just scans all transformed resources to find table definitions,
   * but `Transformer` needs at least a dummy directive passed in for proper
   * initialization.
   */
  constructor() {
    super(
      'CapbaseAmplifyAuthTransformer',
      gql`directive @capbaseAuth on OBJECT`
    );
  }

  /**
   * Required by the `Transformer` class to have a definition here because of where we
   * arbitrarily chose to bind our directive in the schema just above. So we just
   * define this as a noop
   */
  object = (def, directive, ctx) => {/* noop */}

  /**
   * After the `TransformationContext` is fully built up, go through each table definition
   * and add properties importing some other table definitions into the stack with the goal of
   * reducing the overall number of concurrent table creations so that the concurrent creation
   * limit of ddb tables in AWS is not reached.
   */
  after = (ctx) => {
    const template = ctx.template;

    Object.values(template.Resources)
      .filter(({ Type, Properties }) => Type === "AWS::AppSync::Resolver" && Properties.TypeName === "Query")
      .forEach(({ Properties }) => {
        ["RequestMappingTemplate", "ResponseMappingTemplate"].forEach((field) => {
          Properties[field] = `## [Start] Impersonation sub Replacement
#set( $userGroups = $util.defaultIfNull($ctx.identity.claims.get("cognito:groups"), []) )
#set( $disallowedGroup = "Impersonated-User" )
#if( $userGroups.contains($disallowedGroup) )
  #set( $ctx.identity.claims.sub = $ctx.identity.claims.impersonatedSub )
#end
## [End] Impersonation sub Replacement
${Properties[field]}`;
        })
      });

    Object.values(template.Resources)
      .filter(({ Type, Properties }) => Type === "AWS::AppSync::Resolver" && Properties.TypeName === "Mutation")
      .forEach(({ Properties }) => {
        Properties.RequestMappingTemplate = `## [Start] Impersonation Check
#set( $userGroups = $util.defaultIfNull($ctx.identity.claims.get("cognito:groups"), []) )
#set( $disallowedGroup = "Impersonated-User" )
#if( $userGroups.contains($disallowedGroup) )
  $util.unauthorized()
#end
## [End] Impersonation Check
${Properties.RequestMappingTemplate}`;
      });
  }
}

module.exports = { default: CapbaseAmplifyAuthTransformer };
