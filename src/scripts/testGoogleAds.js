import "dotenv/config";
import axios from "axios";

try {
  const r = await axios.post("https://oauth2.googleapis.com/token", {
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const token = r.data.access_token;
  console.log("Token OK:", token.slice(0, 30) + "...");

  const customerId = process.env.GOOGLE_CUSTOMER_ID || "9407759088";
  const r2 = await axios.post(
    `https://googleads.googleapis.com/v19/customers/${customerId}:mutateResources`,
    { mutate_operations: [] },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
        "login-customer-id": customerId,
        "Content-Type": "application/json",
      },
    }
  );
  console.log("API OK:", JSON.stringify(r2.data));
} catch (e) {
  console.error("Status:", e.response?.status);
  console.error("Data:", JSON.stringify(e.response?.data, null, 2));
}
