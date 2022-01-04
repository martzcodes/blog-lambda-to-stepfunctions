import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import axios from "axios";
import { DocumentClient } from "aws-sdk/clients/dynamodb";

const { API_URL, TABLE_NAME } = process.env;
const db = new DocumentClient();

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  if (!event || !event.pathParameters) {
    throw new Error("No Event");
  }
  if (!API_URL || !TABLE_NAME) {
    throw new Error("Missing ENV");
  }
  // make axios call to "external" api to get user name
  const { data: externalUser } = await axios.get(
    `${API_URL}/external/${event.pathParameters.userId}`
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
  if (internalUser && internalUser.locked) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        userLocked: true,
        nameChanged: false,
      }),
    };
  }

  // store user in dynamodb
  const updateItemInput: DocumentClient.UpdateItemInput = {
    TableName: TABLE_NAME,
    Key: {
      PK: externalUser.userId,
    },
    UpdateExpression: `SET #name = :name, ${
      !internalUser
        ? "#history = :history"
        : "#history.#historical = if_not_exists(#history.#historical, :historical)"
    }`,
    ExpressionAttributeNames: { "#name": "name", "#history": "history" },
    ExpressionAttributeValues: {
      ":name": externalUser.name,
    },
    ReturnValues: 'UPDATED_NEW',
  };
  if (!internalUser) {
    updateItemInput!.ExpressionAttributeValues![":history"] = {
      [externalUser.name]: new Date().getTime(),
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
      userLocked: false,
      nameChanged: !!updatedItem?.Attributes?.name,
    }),
  };
};
