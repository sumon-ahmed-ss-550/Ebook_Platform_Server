const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const dotenv = require("dotenv");

dotenv.config();
const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = process.env.MONGODB_URI;
const jwtSecret = process.env.JWT_SECRET || "fable_secret_key_123";

// Middleware
app.use(cors());

app.post(
  "/api/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (err) {
      console.error("Webhook Error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const orderInfo = {
        userId: session.metadata.userId,
        userEmail: session.metadata.userEmail,
        bookId: session.metadata.bookId,
        bookTitle: session.metadata.bookTitle,
        price: parseFloat(session.metadata.price),
        transactionId: session.payment_intent,
        paymentStatus: "Paid",
        createdAt: new Date(),
      };

      try {
        const result = await ordersCollection.insertOne(orderInfo);
        console.log("Order saved successfully:", result.insertedId);
      } catch (error) {
        console.error("Error saving order to database:", error);
      }
    }

    res.json({ received: true });
  },
);

app.use(express.json());

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Global Collections
let booksCollection;
let usersCollection;
let ordersCollection;

const run = async () => {
  try {
    await client.connect();
    const database = client.db("ebook_platform");

    booksCollection = database.collection("books");
    usersCollection = database.collection("users");
    ordersCollection = database.collection("orders"); // নতুন অর্ডার কালেকশন

    // Ensure unique index for email in users collection
    await usersCollection.createIndex({ email: 1 }, { unique: true });

    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } catch (error) {
    console.error("Database connection error:", error);
  }
};
run().catch(console.dir);

const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
  const token = authHeader.split(" ")[1];

  jwt.verify(token, jwtSecret, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
};

const verifyRole = (roles) => {
  return (req, res, next) => {
    const userRole = req.decoded.role;
    if (!roles.includes(userRole)) {
      return res
        .status(403)
        .send({ message: "Forbidden: You do not have permission" });
    }
    next();
  };
};

app.get("/", (req, res) => {
  res.send("Fable Ebook Platform Server is running...");
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      return res.status(400).send({ message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      name,
      email,
      password: hashedPassword,
      role: role || "Reader",
      createdAt: new Date(),
    };
    const result = await usersCollection.insertOne(newUser);

    const token = jwt.sign(
      { id: result.insertedId, email, role: newUser.role },
      jwtSecret,
      { expiresIn: "7d" },
    );
    res.status(201).send({ token, user: { name, email, role: newUser.role } });
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).send({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      jwtSecret,
      { expiresIn: "7d" },
    );
    res.send({
      token,
      user: { name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});

app.post(
  "/api/ebooks",
  verifyToken,
  verifyRole(["Writer", "Admin"]),
  async (req, res) => {
    try {
      const bookData = req.body;
      const result = await booksCollection.insertOne(bookData);
      res.status(201).send(result);
    } catch (error) {
      res.status(500).send({ message: error.message });
    }
  },
);

// app.get("/api/ebooks", async (req, res) => {
//   try {
//     const result = await booksCollection.find({}).toArray();
//     res.send(result);
//   } catch (error) {
//     res.status(500).send({ message: error.message });
//   }
// });

// app.get("/api/ebooks/:id", async (req, res) => {
//   try {
//     const id = req.params.id;
//     const query = { _id: new ObjectId(id) };
//     const result = await booksCollection.findOne(query);
//     if (!result) {
//       return res.status(404).send({ message: "Ebook not found" });
//     }
//     res.send(result);
//   } catch (error) {
//     res.status(500).send({ message: error.message });
//   }
// });

// app.post(
//   "/api/upload-image",
//   verifyToken,
//   verifyRole(["Writer", "Admin"]),
//   upload.single("image"),
//   async (req, res) => {
//     try {
//       if (!req.file) {
//         return res.status(400).send({ message: "No image file provided" });
//       }

//       const form = new FormData();
//       form.append("image", req.file.buffer.toString("base64"));

//       const imgbbResponse = await axios.post(
//         `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
//         form,
//         { headers: form.getHeaders() },
//       );

//       res.send({ imageUrl: imgbbResponse.data.data.url });
//     } catch (error) {
//       res.status(500).send({ message: error.message });
//     }
//   },
// );

// app.post("/api/create-checkout-session", verifyToken, async (req, res) => {
//   try {
//     const { bookId } = req.body;
//     const userEmail = req.decoded.email;
//     const userId = req.decoded.id;

//     const book = await booksCollection.findOne({ _id: new ObjectId(bookId) });
//     if (!book) {
//       return res.status(404).send({ message: "Ebook not found" });
//     }

//     const alreadyPurchased = await ordersCollection.findOne({ userId, bookId });
//     if (alreadyPurchased) {
//       return res
//         .status(400)
//         .send({ message: "You have already purchased this ebook" });
//     }

//     const session = await stripe.checkout.sessions.create({
//       payment_method_types: ["card"],
//       line_items: [
//         {
//           price_data: {
//             currency: "usd",
//             product_data: {
//               name: book.title,
//               description: book.description || `Purchase ${book.title}`,
//               images: book.image ? [book.image] : [],
//             },
//             unit_amount: Math.round(book.price * 100), // সেন্টে কনভার্ট (যেমন: $14.99 -> 1499)
//           },
//           quantity: 1,
//         },
//       ],
//       mode: "payment",
//       success_url: `${process.env.CLIENT_URL}/dashboard/library?success=true`,
//       cancel_url: `${process.env.CLIENT_URL}/ebook/${bookId}?canceled=true`,
//       metadata: {
//         userId: userId,
//         userEmail: userEmail,
//         bookId: bookId,
//         bookTitle: book.title,
//         price: book.price.toString(),
//       },
//     });

//     res.send({ id: session.id, url: session.url });
//   } catch (error) {
//     res.status(500).send({ message: error.message });
//   }
// });

// app.get("/api/my-library", verifyToken, async (req, res) => {
//   try {
//     const userId = req.decoded.id;
//     const purchasedBooks = await ordersCollection.find({ userId }).toArray();
//     res.send(purchasedBooks);
//   } catch (error) {
//     res.status(500).send({ message: error.message });
//   }
// });

app.listen(port, () => {
  console.log(`Fable server listening on port ${port}`);
});
