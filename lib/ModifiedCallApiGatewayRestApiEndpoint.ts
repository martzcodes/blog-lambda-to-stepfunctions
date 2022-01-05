import { CallApiGatewayRestApiEndpoint, CallApiGatewayRestApiEndpointProps } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";

// Hack from: https://github.com/aws/aws-cdk/issues/14243
export class ModifiedCallApiGatewayRestApiEndpoint extends CallApiGatewayRestApiEndpoint {
  constructor(
    scope: Construct,
    id: string,
    props: CallApiGatewayRestApiEndpointProps
  ) {
    super(scope, id, props);
  }

  protected _renderTask(): any {
    const orig = super._renderTask();
    const ret = {};
    Object.assign(ret, orig, {
      Parameters: { "Path.$": "$.apiPath", ...orig.Parameters },
    });
    return ret;
  }
}