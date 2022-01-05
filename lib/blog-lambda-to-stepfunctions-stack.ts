import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import {
  LambdaIntegration,
  RestApi,
} from "aws-cdk-lib/aws-apigateway";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { BlogStepFunction } from "./step-function";

export class BlogLambdaToStepfunctionsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const mockUser = new NodejsFunction(this, "mockUserFn", {
      runtime: Runtime.NODEJS_14_X,
      architecture: Architecture.ARM_64,
      entry: `${__dirname}/../lambda/mockUser.ts`,
    });

    const table = new Table(this, "BlogLambdaSFTable", {
      partitionKey: {
        name: "PK",
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      tableName: "BlogLambdaSFTable",
    });

    const mockExternalApi = new RestApi(this, "MockExternalAPI", {
      restApiName: "MockExternalAPI",
    });

    mockExternalApi.root
      .addResource("{userId}")
      .addMethod("GET", new LambdaIntegration(mockUser));

    const bigLambda = new NodejsFunction(this, "bigLambda", {
      runtime: Runtime.NODEJS_14_X,
      architecture: Architecture.ARM_64,
      entry: `${__dirname}/../lambda/bigLambda.ts`,
      environment: {
        TABLE_NAME: table.tableName,
        API_URL: mockExternalApi.url,
      },
      logRetention: RetentionDays.ONE_DAY,
    });

    table.grantReadWriteData(bigLambda);

    const api = new RestApi(this, "BlogLambdaSFAPI", {
      restApiName: "BlogLambdaSFAPI",
    });

    api.root
      .addResource("big")
      .addResource("{userId}")
      .addMethod("GET", new LambdaIntegration(bigLambda));

    BlogStepFunction(this, { api, mockExternalApi, table });

  }
}
