import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { LambdaIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import { RetentionDays } from "aws-cdk-lib/aws-logs";

export class BlogLambdaToStepfunctionsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const mockUser = new NodejsFunction(this, "mockUserFn", {
      runtime: Runtime.NODEJS_14_X,
      architecture: Architecture.ARM_64,
      entry: `${__dirname}/../lambda/mockUser.ts`,
    });

    const table = new Table(this, "SomeTable", {
      partitionKey: {
        name: "PK",
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      tableName: "SomeTable",
    });

    const api = new RestApi(this, "SomeAPI", {
      restApiName: "SomeAPI",
    });

    api.root
      .addResource("external")
      .addResource("{userId}")
      .addMethod("GET", new LambdaIntegration(mockUser));

    const bigLambda = new NodejsFunction(this, "bigLambda", {
      runtime: Runtime.NODEJS_14_X,
      architecture: Architecture.ARM_64,
      entry: `${__dirname}/../lambda/bigLambda.ts`,
      environment: {
        TABLE_NAME: table.tableName,
        API_URL: 'https://a6iwkx9xkd.execute-api.us-east-1.amazonaws.com/prod/', // set this to your API URL, making this a string avoids a circular dependency
      },
      logRetention: RetentionDays.ONE_DAY,
    });

    table.grantReadWriteData(bigLambda);

    api.root
      .addResource("big")
      .addResource("{userId}")
      .addMethod("GET", new LambdaIntegration(bigLambda));
  }
}
