import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { name } from "faker";

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log(JSON.stringify(event, null, 2));
  // This lambda is a mock for an external API request that returns a "user"
  if (!event || !event.pathParameters) {
    throw new Error("No Event");
  }

  const mockUser = {
    userId: `EXTERNAL#${event.pathParameters.userId}`,
    name: (event.queryStringParameters || {}).name || name.findName(),
  };

  console.log(`Mock User: ${JSON.stringify(mockUser, null, 2)}`);
  return {
    statusCode: 200,
    body: JSON.stringify(mockUser),
  };
};
