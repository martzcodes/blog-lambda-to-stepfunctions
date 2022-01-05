import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import axios from "axios";
import { DocumentClient } from "aws-sdk/clients/dynamodb";

const { API_URL, TABLE_NAME } = process.env;
const db = new DocumentClient();

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log(`API_URL: ${API_URL}`);
  if (!event || !event.pathParameters) {
    throw new Error("No Event");
  }
  if (!API_URL || !TABLE_NAME) {
    throw new Error("Missing ENV");
  }
  // make axios call to "external" api to get user name
  const { data: externalUser } = await axios.get(
    `${API_URL}/${event.pathParameters.userId}`
  );
  console.log(`external user: ${JSON.stringify(externalUser, null, 2)}`);

  // get existing user by id
  const userGetItemInput: DocumentClient.GetItemInput = {
    TableName: TABLE_NAME,
    Key: {
      PK: externalUser.userId,
    },
  };

  const { Item: internalUser } = await db.get(userGetItemInput).promise();
  console.log(`existing user: ${JSON.stringify(internalUser, null, 2)}`);

  // if user locked return
  if (internalUser && internalUser.status === 'LOCKED') {
    return {
      statusCode: 200,
      body: JSON.stringify({
        id: externalUser.userId,
        name: internalUser.name,
        status: internalUser.status,
        userLocked: true,
        nameChanged: false,
        inserted: false
      }),
    };
  }

  // store user in dynamodb
  const updateItemInput: DocumentClient.UpdateItemInput = {
    TableName: TABLE_NAME,
    Key: {
      PK: externalUser.userId,
    },
    UpdateExpression: `SET #name = :name, #status = :status, ${
      !internalUser
        ? "#history = :history"
        : "#history.#historical = if_not_exists(#history.#historical, :historical)"
    }`,
    ExpressionAttributeNames: { "#name": "name", "#history": "history", "#status": "status" },
    ExpressionAttributeValues: {
      ":name": externalUser.name,
      ":status": "ACTIVE"
    },
    ReturnValues: "UPDATED_NEW",
  };
  if (!internalUser) {
    updateItemInput!.ExpressionAttributeValues![":history"] = {
      [externalUser.name]: new Date().toISOString(),
    };
  } else {
    updateItemInput!.ExpressionAttributeNames!["#historical"] =
      externalUser.name;
    updateItemInput!.ExpressionAttributeValues![":historical"] =
      new Date().getTime();
  }
  const updatedItem = await db.update(updateItemInput).promise();
  console.log(`Updated Item: ${JSON.stringify(updatedItem)}`);

  return {
    statusCode: 200,
    body: JSON.stringify({
      id: externalUser.userId,
      name: externalUser.name,
      status: internalUser?.status || 'ACTIVE',
      userLocked: false,
      nameChanged: !!updatedItem?.Attributes?.name,
      inserted: !!updatedItem?.Attributes?.PK,
    }),
  };
};
