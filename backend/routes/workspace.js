import express from "express";
import Workspace from "../models/Workspace.js";
import User from "../models/User.js";  // นำเข้า User model
import authenticateToken from "../middleware/auth.js";

const router = express.Router();

// 1. สร้าง Workspace ใหม่
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { name, type, budget, members } = req.body;
    
    if (!req.user?.id) {
      return res.status(400).json({ error: "User authentication data is incomplete" });
    }
    
    const owner = req.user.id;
    
    if (!name || !type) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const workspaceData = {
      name,
      owner,
      type,
      budget: budget || 0,
      members: members?.length ? 
        members.map(member => ({
          user: member.user,
          join_at: new Date()
        })) : 
        [{ user: owner, join_at: new Date() }],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const workspace = new Workspace(workspaceData);
    await workspace.save();
    
    // populate members.user เพื่อส่งข้อมูล user กลับไป
    const populatedWorkspace = await Workspace.findById(workspace._id)
      .populate('members.user', 'username name email');
      
    res.status(201).json(populatedWorkspace);
  } catch (err) {
    console.error("Workspace creation error:", err);
    res.status(500).json({ error: "Failed to create workspace", message: err.message });
  }
});

// เพิ่มเส้นทางสำหรับดึงข้อมูล workspace ทั้งหมดของผู้ใช้
router.get("/", authenticateToken, async (req, res) => {
  try {
    // console.log("GET /workspaces endpoint hit");
    // console.log("User data:", req.user);
    // ตรวจสอบว่า req.user มีข้อมูลหรือไม่
    if (!req.user || !req.user.id) {
      return res.status(400).json({ error: "User authentication data is incomplete" });
    }

    // ค้นหา workspace ที่ผู้ใช้เป็นเจ้าของหรือเป็นสมาชิก
    const workspaces = await Workspace.find({
      $or: [
        { owner: req.user.id },  // เป็นเจ้าของ
        { 'members.user': req.user.id }  // เป็นสมาชิก
      ]
    });
    // console.log("Found workspaces:", workspaces);
    res.json(workspaces);
  } catch (err) {
    console.error("Fetch workspaces error:", err);
    res.status(500).json({ error: "Failed to fetch workspaces", message: err.message });
  }
});

// 2. ดึงข้อมูล Workspace ตาม ID
router.get("/:workspaceId", authenticateToken, async (req, res) => {
  const { workspaceId } = req.params;

  try {
    const workspace = await Workspace.findById(workspaceId).populate("members.user");

    if (!workspace) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    res.json(workspace);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch workspace", message: err.message });
  }
});

// 3. เพิ่มสมาชิกใน workspace โดยใช้ email
router.put("/:workspaceId/member", authenticateToken, async (req, res) => {
  const { workspaceId } = req.params;
  const { email } = req.body;  // ไม่มี role อีกแล้ว

  if (!email) {
    return res.status(400).json({ error: "Missing email" });
  }

  try {
    // ค้นหาผู้ใช้จาก email
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ error: "User with the given email not found" });
    }

    // ค้นหา workspace ตาม ID
    const workspace = await Workspace.findById(workspaceId);

    if (!workspace) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    // ตรวจสอบว่า user นี้อยู่ใน members ของ workspace หรือยัง
    const isAlreadyMember = workspace.members.some(member => member.user.toString() === user._id.toString());
    if (isAlreadyMember) {
      return res.status(400).json({ error: "User is already a member of this workspace" });
    }

    // เพิ่มสมาชิกใหม่เข้า workspace โดยไม่ต้องใช้ role
    workspace.members.push({
      user: user._id,
      join_at: new Date(),
    });

    await workspace.save();
    res.json(workspace);
  } catch (err) {
    res.status(500).json({ error: "Failed to add member", message: err.message });
  }
});


// 4. อัพเดตข้อมูล Workspace
router.put("/:workspaceId", authenticateToken, async (req, res) => {
  const { workspaceId } = req.params;
  const { name, type, budget } = req.body;

  try {
    const workspace = await Workspace.findById(workspaceId);

    if (!workspace) {
      return res.status(404).json({ error: "Workspace not found" });
    }
    // ตรวจสอบว่า req.user มีข้อมูลหรือไม่
    if (!req.user || !req.user.id) {
      return res.status(400).json({ error: "User authentication data is incomplete" });
    }

    // ตรวจสอบว่า user เป็นเจ้าของ workspace หรือไม่
    if (workspace.owner.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: "You are not authorized to update this workspace" });
    }

    // อัพเดตข้อมูล workspace
    workspace.name = name || workspace.name;
    workspace.type = type || workspace.type;
    workspace.budget = budget || workspace.budget;
    workspace.update = new Date();

    await workspace.save();
    res.json(workspace);
  } catch (err) {
    res.status(500).json({ error: "Failed to update workspace", message: err.message });
  }
});

// 5. ลบสมาชิกออกจาก Workspace
router.delete("/:workspaceId/member/:userId", authenticateToken, async (req, res) => {
  const { workspaceId, userId } = req.params;

  try {
    const workspace = await Workspace.findById(workspaceId);

    if (!workspace) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    // ตรวจสอบว่า user ที่จะลบออกเป็นสมาชิกใน workspace หรือไม่
    const memberIndex = workspace.members.findIndex(member => member.user.toString() === userId);

    if (memberIndex === -1) {
      return res.status(400).json({ error: "User is not a member of this workspace" });
    }

    // ลบสมาชิกออกจาก workspace
    workspace.members.splice(memberIndex, 1);
    await workspace.save();
    res.json({ message: "User removed from workspace" });
  } catch (err) {
    res.status(500).json({ error: "Failed to remove member", message: err.message });
  }
});


// 6. ลบ Workspace
router.delete("/:workspaceId", authenticateToken, async (req, res) => {
  const { workspaceId } = req.params;

  try {
    const workspace = await Workspace.findById(workspaceId);

    if (!workspace) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    // ตรวจสอบว่า req.user มีข้อมูลหรือไม่
    if (!req.user || !req.user.id) {
      return res.status(400).json({ error: "User authentication data is incomplete" });
    }

    // ตรวจสอบว่า user เป็นเจ้าของ workspace หรือไม่
    if (workspace.owner.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: "You are not authorized to delete this workspace" });
    }

    // ใช้ deleteOne() แทน delete()
    await Workspace.deleteOne({ _id: workspaceId });
    // หรือใช้ findByIdAndDelete
    // await Workspace.findByIdAndDelete(workspaceId);

    res.json({ message: "Workspace deleted" });
  } catch (err) {
    console.error("Delete workspace error:", err);
    res.status(500).json({ error: "Failed to delete workspace", message: err.message });
  }
});

export default router;
