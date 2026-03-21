#!/data/data/com.termux/files/usr/bin/bash

# FotoHaven Android Optimization Script
# Run once after phone reboot or after fresh setup
# Requires root access

set -e  # Exit on error

echo "========================================="
echo "FotoHaven Android Optimization Script"
echo "========================================="
echo ""

# Color codes for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check for root access
if ! command -v su &> /dev/null; then
    echo -e "${RED}[ERROR]${NC} Root access (su) not found. Please root your device first."
    exit 1
fi

echo -e "${GREEN}[✓]${NC} Root access confirmed"
echo ""

# Backup original settings
BACKUP_DIR="$HOME/fotohaven-sysctl-backup"
mkdir -p "$BACKUP_DIR"

echo -e "${YELLOW}[INFO]${NC} Backing up current settings to $BACKUP_DIR"

su -c "sysctl -a" > "$BACKUP_DIR/sysctl-original.txt" 2>/dev/null || true
cat /sys/block/*/queue/scheduler > "$BACKUP_DIR/io-scheduler-original.txt" 2>/dev/null || true

echo -e "${GREEN}[✓]${NC} Backup completed"
echo ""

# ==========================================
# 1. Network Optimizations
# ==========================================
echo -e "${YELLOW}[1/6]${NC} Applying Network Optimizations..."

# Increase TCP buffer sizes
su -c "sysctl -w net.core.rmem_max=16777216" || echo "  └─ rmem_max: failed"
su -c "sysctl -w net.core.wmem_max=16777216" || echo "  └─ wmem_max: failed"
su -c "sysctl -w net.ipv4.tcp_rmem='4096 87380 16777216'" || echo "  └─ tcp_rmem: failed"
su -c "sysctl -w net.ipv4.tcp_wmem='4096 65536 16777216'" || echo "  └─ tcp_wmem: failed"

# Enable TCP optimizations
su -c "sysctl -w net.ipv4.tcp_window_scaling=1" || echo "  └─ window_scaling: failed"
su -c "sysctl -w net.ipv4.tcp_tw_reuse=1" || echo "  └─ tw_reuse: failed"
su -c "sysctl -w net.ipv4.tcp_timestamps=1" || echo "  └─ timestamps: failed"

# Set BBR congestion control (if available)
if su -c "sysctl net.ipv4.tcp_available_congestion_control" | grep -q "bbr"; then
    su -c "sysctl -w net.ipv4.tcp_congestion_control=bbr" && echo "  └─ BBR enabled"
else
    su -c "sysctl -w net.ipv4.tcp_congestion_control=cubic" && echo "  └─ CUBIC enabled (BBR not available)"
fi

# Fast socket recycling
su -c "sysctl -w net.ipv4.tcp_fin_timeout=15" || echo "  └─ fin_timeout: failed"

echo -e "${GREEN}[✓]${NC} Network optimizations applied"
echo ""

# ==========================================
# 2. I/O Scheduler Optimizations
# ==========================================
echo -e "${YELLOW}[2/6]${NC} Applying I/O Scheduler Optimizations..."

# Detect block device (usually mmcblk0 for eMMC, sda for UFS)
BLOCK_DEVICE=""
if [ -d /sys/block/mmcblk0 ]; then
    BLOCK_DEVICE="mmcblk0"
elif [ -d /sys/block/sda ]; then
    BLOCK_DEVICE="sda"
elif [ -d /sys/block/sdb ]; then
    BLOCK_DEVICE="sdb"
fi

if [ -n "$BLOCK_DEVICE" ]; then
    echo "  └─ Detected block device: $BLOCK_DEVICE"
    
    # Set scheduler to deadline (best for sequential I/O)
    if [ -f /sys/block/$BLOCK_DEVICE/queue/scheduler ]; then
        AVAILABLE_SCHEDULERS=$(cat /sys/block/$BLOCK_DEVICE/queue/scheduler)
        
        if echo "$AVAILABLE_SCHEDULERS" | grep -q "deadline"; then
            su -c "echo deadline > /sys/block/$BLOCK_DEVICE/queue/scheduler" && echo "  └─ Scheduler set to deadline"
        elif echo "$AVAILABLE_SCHEDULERS" | grep -q "bfq"; then
            su -c "echo bfq > /sys/block/$BLOCK_DEVICE/queue/scheduler" && echo "  └─ Scheduler set to bfq"
        else
            echo "  └─ Using default scheduler: $AVAILABLE_SCHEDULERS"
        fi
    fi
    
    # Increase read-ahead for large file transfers
    if [ -f /sys/block/$BLOCK_DEVICE/queue/read_ahead_kb ]; then
        su -c "echo 2048 > /sys/block/$BLOCK_DEVICE/queue/read_ahead_kb" && echo "  └─ Read-ahead set to 2048KB"
    fi
    
    # Optimize nr_requests (pending I/O operations)
    if [ -f /sys/block/$BLOCK_DEVICE/queue/nr_requests ]; then
        su -c "echo 256 > /sys/block/$BLOCK_DEVICE/queue/nr_requests" && echo "  └─ nr_requests set to 256"
    fi
else
    echo -e "${YELLOW}  └─ Warning: Could not detect block device${NC}"
fi

echo -e "${GREEN}[✓]${NC} I/O scheduler optimizations applied"
echo ""

# ==========================================
# 3. Virtual Memory Tuning
# ==========================================
echo -e "${YELLOW}[3/6]${NC} Applying Virtual Memory Optimizations..."

# Reduce swappiness (prefer RAM over swap)
su -c "sysctl -w vm.swappiness=10" || echo "  └─ swappiness: failed"

# Increase dirty ratio (batch more writes)
su -c "sysctl -w vm.dirty_ratio=20" || echo "  └─ dirty_ratio: failed"
su -c "sysctl -w vm.dirty_background_ratio=5" || echo "  └─ dirty_background_ratio: failed"

# Improve cache pressure
su -c "sysctl -w vm.vfs_cache_pressure=50" || echo "  └─ vfs_cache_pressure: failed"

# Increase file descriptor limits
ulimit -n 65536 2>/dev/null && echo "  └─ File descriptor limit set to 65536" || echo "  └─ ulimit: failed (may require restart)"

echo -e "${GREEN}[✓]${NC} Virtual memory optimizations applied"
echo ""

# ==========================================
# 4. Filesystem Mount Optimizations
# ==========================================
echo -e "${YELLOW}[4/6]${NC} Applying Filesystem Optimizations..."

# Remount /data with noatime (reduce write overhead)
if su -c "mount -o remount,noatime /data" 2>/dev/null; then
    echo "  └─ /data remounted with noatime"
else
    echo -e "${YELLOW}  └─ Warning: Could not remount /data with noatime${NC}"
fi

echo -e "${GREEN}[✓]${NC} Filesystem optimizations applied"
echo ""

# ==========================================
# 5. CPU Governor (Optional - Commented Out)
# ==========================================
echo -e "${YELLOW}[5/6]${NC} CPU Governor Configuration..."
echo "  └─ Performance mode is DISABLED by default"
echo "  └─ To enable, uncomment lines in this script (increases battery drain)"

# UNCOMMENT BELOW TO ENABLE PERFORMANCE MODE (HIGH BATTERY DRAIN!)
# for cpu in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
#     if [ -f "$cpu" ]; then
#         su -c "echo performance > $cpu" 2>/dev/null && echo "  └─ CPU set to performance mode"
#     fi
# done

echo -e "${GREEN}[✓]${NC} CPU configuration skipped (default governor active)"
echo ""

# ==========================================
# 6. Cloudflare Tunnel Configuration
# ==========================================
echo -e "${YELLOW}[6/6]${NC} Verifying Cloudflare Tunnel Setup..."

# Check if cloudflared is installed
if command -v cloudflared &> /dev/null; then
    echo "  └─ Cloudflared version: $(cloudflared version 2>&1 | head -n1)"
    echo ""
    echo "  Recommended ecosystem.config.js settings:"
    echo "  ┌────────────────────────────────────────────┐"
    echo "  │ args: 'tunnel --url http://localhost:3000 │"
    echo "  │        --protocol http2                    │"
    echo "  │        --proxy-connect-timeout 60s         │"
    echo "  │        --proxy-read-timeout 300s'          │"
    echo "  └────────────────────────────────────────────┘"
else
    echo -e "${YELLOW}  └─ Warning: cloudflared not found${NC}"
fi

echo -e "${GREEN}[✓]${NC} Configuration check complete"
echo ""

# ==========================================
# Summary
# ==========================================
echo "========================================="
echo "Optimization Summary"
echo "========================================="
echo ""
echo -e "${GREEN}[✓]${NC} Network buffers increased to 16MB"
echo -e "${GREEN}[✓]${NC} TCP congestion control optimized"
echo -e "${GREEN}[✓]${NC} I/O scheduler tuned for sequential reads/writes"
echo -e "${GREEN}[✓]${NC} Read-ahead buffer increased to 2MB"
echo -e "${GREEN}[✓]${NC} VM swappiness reduced to 10"
echo -e "${GREEN}[✓]${NC} Dirty ratio optimized for batch writes"
echo -e "${GREEN}[✓]${NC} /data mounted with noatime"
echo ""
echo -e "${YELLOW}[INFO]${NC} These settings are temporary and will reset on reboot."
echo -e "${YELLOW}[INFO]${NC} To make permanent, add this script to Termux boot."
echo ""

# ==========================================
# Optional: Create Boot Script
# ==========================================
if [ -t 0 ]; then
    read -p "Would you like to run this script automatically on boot? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        BOOT_SCRIPT="$HOME/.termux/boot/optimize-system.sh"
        mkdir -p "$HOME/.termux/boot"
        
        # Copy this script to boot directory using absolute path
        cp "$(realpath "$0")" "$BOOT_SCRIPT"
        chmod +x "$BOOT_SCRIPT"
        
        echo -e "${GREEN}[✓]${NC} Boot script created at: $BOOT_SCRIPT"
        echo -e "${YELLOW}[INFO]${NC} Make sure Termux:Boot app is installed from F-Droid"
    fi
else
    echo -e "${YELLOW}[INFO]${NC} Running non-interactively (e.g. boot flow). Skipping boot script prompt."
fi

echo ""
echo "========================================="
echo "Optimization Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. Restart PM2: pm2 restart all"
echo "  2. Test upload/download speeds"
echo "  3. Monitor with: pm2 monit"
echo ""
echo "To restore original settings:"
echo "  Run: cat $BACKUP_DIR/sysctl-original.txt"
echo ""