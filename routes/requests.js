import express from "express";
import Request from "../models/Request.js";
import Workspace from "../models/Workspace.js";
import authenticateToken from "../middleware/auth.js";

const router = express.Router();

// 1️⃣ ขอเบิกงบประมาณ (POST /requests)
router.post("/", authenticateToken, async (req, res) => {
  const { workspaceId, amount, items, proof } = req.body;
  const requester = req.user._id;

  if (!workspaceId || !amount || !items || !proof) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const workspace = await Workspace.findById(workspaceId);

    if (!workspace || workspace.type !== "project") {
      return res.status(400).json({ error: "Invalid workspace or not a project workspace" });
    }

    const request = new Request({
      workspace: workspaceId,
      requester,
      amount,
      items,
      proof,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await request.save();
    res.status(201).json(request);
  } catch (err) {
    res.status(500).json({ error: "Failed to create request", message: err.message });
  }
});

// 2️⃣ ดึงรายการขอเบิกงบของ Workspace (GET /requests/:workspaceId)
router.get("/:workspaceId", authenticateToken, async (req, res) => {
  const { workspaceId } = req.params;

  try {
    const requests = await Request.find({ workspace: workspaceId }).populate("requester", "name email");

    if (!requests.length) {
      return res.status(404).json({ error: "No requests found for this workspace" });
    }

    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch requests", message: err.message });
  }
});

// 3️⃣ อัพเดตสถานะคำขอ (PUT /requests/:requestId/status)
router.put("/:requestId/status", authenticateToken, async (req, res) => {
  const { requestId } = req.params;
  const { status } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  try {
    const request = await Request.findById(requestId);

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    // ตรวจสอบว่า user เป็น owner ของ workspace หรือไม่
    const workspace = await Workspace.findById(request.workspace);
    if (workspace.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Unauthorized to update request status" });
    }

    request.status = status;
    request.updatedAt = new Date();
    await request.save();

    res.json(request);
  } catch (err) {
    res.status(500).json({ error: "Failed to update request status", message: err.message });
  }
});

// 4️⃣ ลบคำขอเบิกงบ (DELETE /requests/:requestId)
router.delete("/:requestId", authenticateToken, async (req, res) => {
  const { requestId } = req.params;

  try {
    const request = await Request.findById(requestId);

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    // ตรวจสอบว่าเป็นผู้ขอเบิกหรือ owner ของ workspace
    const workspace = await Workspace.findById(request.workspace);
    if (request.requester.toString() !== req.user._id.toString() && workspace.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Unauthorized to delete this request" });
    }

    await request.deleteOne();
    res.json({ message: "Request deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete request", message: err.message });
  }
});

export default router;
