import { RemovalPolicy } from "aws-cdk-lib";
import { AwsIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { Effect, Policy, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Choice, Condition, JsonPath, LogLevel, Pass, StateMachine, StateMachineType } from "aws-cdk-lib/aws-stepfunctions";
import { DynamoAttributeValue, DynamoGetItem, DynamoPutItem, DynamoUpdateItem, HttpMethod } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";
import { ModifiedCallApiGatewayRestApiEndpoint } from "./ModifiedCallApiGatewayRestApiEndpoint";

export interface BlogStepFunctionProps {
    api: RestApi;
    mockExternalApi: RestApi;
    table: Table
}

export const BlogStepFunction = (scope: Construct, props: BlogStepFunctionProps) => {
    const pass = new Pass(scope, "RoutePass", {
      parameters: {
        "apiPath.$": "States.Format('/{}', $.userId)",
        "userId.$": "$.userId",
        "name.$": "$.name",
      },
    });

    const callExternal = new ModifiedCallApiGatewayRestApiEndpoint(
      scope,
      "Call External APIGW",
      {
        api: props.mockExternalApi,
        stageName: "prod",
        method: HttpMethod.GET,
        resultPath: "$.external",
        resultSelector: {
          user: JsonPath.stringAt("$.ResponseBody"),
        },
      }
    );

    const dynamoGet = new DynamoGetItem(scope, "Get Internal User", {
      key: {
        PK: DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.external.user.userId")
        ),
      },
      table: props.table,
      resultPath: "$.internal",
    });

    const userWasLocked = new Pass(scope, "User Was Locked", {
      parameters: {
        id: JsonPath.stringAt("$.external.user.userId"),
        name: JsonPath.stringAt("$.internal.Item.name.S"),
        status: JsonPath.stringAt("$.internal.Item.status.S"),
        userLocked: true,
        nameChanged: false,
        inserted: false,
      },
    });

    const userExists = new Pass(scope, "No Changes to User", {
      parameters: {
        id: JsonPath.stringAt("$.external.user.userId"),
        name: JsonPath.stringAt("$.internal.Item.name.S"),
        status: JsonPath.stringAt("$.internal.Item.status.S"),
        userLocked: false,
        nameChanged: false,
      },
    });

    const userInserted = new Pass(scope, "User Inserted", {
      parameters: {
        id: JsonPath.stringAt("$.external.user.userId"),
        name: JsonPath.stringAt("$.external.user.name"),
        status: "ACTIVE",
        userLocked: false,
        nameChanged: false,
        inserted: true,
      },
    });

    const dynamoInsert = new DynamoPutItem(scope, "Add Internal User", {
      item: {
        PK: DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.external.user.userId")
        ),
        name: DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.external.user.name")
        ),
        status: DynamoAttributeValue.fromString("ACTIVE"),
        history: DynamoAttributeValue.fromMap({
          [JsonPath.stringAt("$.external.user.name")]:
            DynamoAttributeValue.fromString(
              JsonPath.stringAt("$$.State.EnteredTime")
            ),
        }),
      },
      table: props.table,
      resultPath: "$.inserted",
    });
    dynamoInsert.next(userInserted);

    const dynamoUpdate = new DynamoUpdateItem(scope, "Update User Name", {
      key: {
        PK: DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.external.user.userId")
        ),
      },
      table: props.table,
      expressionAttributeNames: {
        "#name": "name",
        "#history": "history",
        "#historical": JsonPath.stringAt("$.external.user.name"),
      },
      expressionAttributeValues: {
        ":name": DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.external.user.name")
        ),
        ":historical": DynamoAttributeValue.fromString(
          JsonPath.stringAt("$$.State.EnteredTime")
        ),
      },
      updateExpression:
        "SET #name = :name, #history.#historical = if_not_exists(#history.#historical, :historical)",
      resultPath: "$.updated",
    });

    const userWasUpdated = new Pass(scope, "User Was Updated", {
      parameters: {
        id: JsonPath.stringAt("$.external.user.userId"),
        name: JsonPath.stringAt("$.external.user.name"),
        status: JsonPath.stringAt("$.internal.Item.status.S"),
        userLocked: false,
        nameChanged: true,
        inserted: false,
      },
    });

    dynamoUpdate.next(userWasUpdated);

    const isUserLocked = new Choice(scope, "User Locked?", {})
      .when(Condition.isNotPresent("$.internal.Item"), dynamoInsert)
      .when(
        Condition.stringEquals(
          "$.internal.Item.name.S",
          "$.external.user.name"
        ),
        userExists
      )
      .when(
        Condition.not(
          Condition.stringEquals(
            "$.internal.Item.name.S",
            "$.external.user.name"
          )
        ),
        dynamoUpdate
      )
      .when(
        Condition.stringEquals("$.internal.Item.status.S", "LOCKED"),
        userWasLocked
      )
      .otherwise(userExists);

    const definition = pass
      .next(callExternal)
      .next(dynamoGet)
      .next(isUserLocked);

    console.log(JSON.stringify(pass.toStateJson(), null, 2));
    console.log(JSON.stringify(callExternal.toStateJson(), null, 2));
    console.log(JSON.stringify(dynamoGet.toStateJson(), null, 2));

    const logGroup = new LogGroup(scope, "BlogLambdaStepLogs", {
      removalPolicy: RemovalPolicy.DESTROY,
      retention: RetentionDays.ONE_DAY,
    });

    const stateMachine = new StateMachine(scope, `BlogLambdaStep`, {
      definition,
      stateMachineType: StateMachineType.EXPRESS,
      logs: {
        destination: logGroup,
        level: LogLevel.ALL,
      },
    });

    props.table.grantReadWriteData(stateMachine);

    const credentialsRole = new Role(scope, "getRole", {
      assumedBy: new ServicePrincipal("apigateway.amazonaws.com"),
    });

    credentialsRole.attachInlinePolicy(
      new Policy(scope, "getPolicy", {
        statements: [
          new PolicyStatement({
            actions: ["states:StartSyncExecution"],
            effect: Effect.ALLOW,
            resources: [stateMachine.stateMachineArn],
          }),
        ],
      })
    );

    const stepApiResource = props.api.root.addResource("step");
    stepApiResource
      .addResource("basic")
      .addResource("{userId}")
      .addMethod(
        "GET",
        new AwsIntegration({
          service: "states",
          action: "StartSyncExecution",
          integrationHttpMethod: "POST",
          options: {
            credentialsRole,
            integrationResponses: [
              {
                statusCode: "200",
                responseTemplates: {
                  "application/json": `#set ($parsedPayload = $util.parseJson($input.json('$.output')))
$parsedPayload`,
                },
              },
            ],
            requestTemplates: {
              "application/json": `{
                "input": "{\\"userId\\": \\"$util.escapeJavaScript($input.params('userId'))\\", \\"name\\": \\"$util.escapeJavaScript($input.params('querystring').params('name'))\\"}",
                "stateMachineArn": "${stateMachine.stateMachineArn}"
              }`,
            },
          },
        }),
        {
          methodResponses: [{ statusCode: "200" }],
        }
      );
};