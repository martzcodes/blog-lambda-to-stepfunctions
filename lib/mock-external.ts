import { LambdaIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

export const mockExternal = (scope: Construct): RestApi => {
    const mockUser = new NodejsFunction(scope, "mockUserFn", {
      runtime: Runtime.NODEJS_14_X,
      architecture: Architecture.ARM_64,
      entry: `${__dirname}/../lambda/mockUser.ts`,
    });

    const mockExternalApi = new RestApi(scope, "MockExternalAPI", {
      restApiName: "MockExternalAPI",
    });

    mockExternalApi.root
      .addResource("{userId}")
      .addMethod("GET", new LambdaIntegration(mockUser));

    return mockExternalApi;
};