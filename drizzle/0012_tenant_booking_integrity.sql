ALTER TABLE otp_challenges ADD COLUMN cafe_id text REFERENCES cafes(id) ON DELETE CASCADE;
--> statement-breakpoint
-- Legacy challenges were not tenant-bound and must not remain usable.
UPDATE otp_challenges SET consumed_at=COALESCE(consumed_at,1);
--> statement-breakpoint
CREATE INDEX idx_otp_cafe_mobile_created ON otp_challenges(cafe_id,mobile,created_at);
--> statement-breakpoint
-- Existing locks are retained. Real intervals, rather than the lock grid, now govern capacity.
CREATE INDEX idx_reservations_active_interval ON reservations(branch_id,status,reserved_at);
--> statement-breakpoint
CREATE TRIGGER reservation_table_scope BEFORE INSERT ON reservation_tables
BEGIN
  SELECT RAISE(ABORT,'invalid_table_scope') WHERE NOT EXISTS (
    SELECT 1 FROM reservations r JOIN cafe_tables t ON t.id=NEW.table_id JOIN areas a ON a.id=t.area_id
    WHERE r.id=NEW.reservation_id AND r.branch_id=a.branch_id
  );
  SELECT RAISE(ABORT,'reservation_overlap') WHERE EXISTS (
    SELECT 1 FROM reservations n JOIN reservation_tables rt ON rt.table_id=NEW.table_id
    JOIN reservations r ON r.id=rt.reservation_id
    WHERE n.id=NEW.reservation_id AND r.id!=n.id
      AND n.status NOT IN ('cancelled','completed','no_show') AND r.status NOT IN ('cancelled','completed','no_show')
      AND datetime(n.reserved_at)<datetime(r.reserved_at,'+'||(r.duration_minutes+r.buffer_minutes)||' minutes')
      AND datetime(r.reserved_at)<datetime(n.reserved_at,'+'||(n.duration_minutes+n.buffer_minutes)||' minutes')
  );
END;
--> statement-breakpoint
-- Associations are replaced as a transaction; never mutate their keys in place.
CREATE TRIGGER reservation_table_immutable BEFORE UPDATE ON reservation_tables
BEGIN SELECT RAISE(ABORT,'replace_reservation_table'); END;
--> statement-breakpoint
CREATE TRIGGER reservation_update_integrity BEFORE UPDATE ON reservations
BEGIN
  SELECT RAISE(ABORT,'terminal_reservation') WHERE OLD.status IN ('cancelled','completed','no_show') AND NEW.status!=OLD.status;
  SELECT RAISE(ABORT,'payment_required') WHERE NEW.payment_status='pending' AND NEW.status IN ('confirmed','arrived','completed');
  SELECT RAISE(ABORT,'invalid_customer_scope') WHERE NEW.customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM customers c JOIN branches b ON b.cafe_id=c.cafe_id WHERE c.id=NEW.customer_id AND b.id=NEW.branch_id
  );
  SELECT RAISE(ABORT,'invalid_table_scope') WHERE EXISTS (
    SELECT 1 FROM reservation_tables rt JOIN cafe_tables t ON t.id=rt.table_id JOIN areas a ON a.id=t.area_id
    WHERE rt.reservation_id=NEW.id AND a.branch_id!=NEW.branch_id
  );
  SELECT RAISE(ABORT,'reservation_overlap') WHERE NEW.status NOT IN ('cancelled','completed','no_show') AND EXISTS (
    SELECT 1 FROM reservation_tables own JOIN reservation_tables rt ON rt.table_id=own.table_id
    JOIN reservations r ON r.id=rt.reservation_id
    WHERE own.reservation_id=NEW.id AND r.id!=NEW.id AND r.status NOT IN ('cancelled','completed','no_show')
      AND datetime(NEW.reserved_at)<datetime(r.reserved_at,'+'||(r.duration_minutes+r.buffer_minutes)||' minutes')
      AND datetime(r.reserved_at)<datetime(NEW.reserved_at,'+'||(NEW.duration_minutes+NEW.buffer_minutes)||' minutes')
  );
END;
--> statement-breakpoint
CREATE TRIGGER reservation_insert_integrity BEFORE INSERT ON reservations
BEGIN
  SELECT RAISE(ABORT,'invalid_customer_scope') WHERE NEW.customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM customers c JOIN branches b ON b.cafe_id=c.cafe_id WHERE c.id=NEW.customer_id AND b.id=NEW.branch_id
  );
  SELECT RAISE(ABORT,'invalid_reservation') WHERE NEW.party_size<1 OR NEW.duration_minutes<=0 OR NEW.buffer_minutes<0
    OR NEW.status NOT IN ('pending','confirmed','arrived','completed','cancelled','no_show');
END;
--> statement-breakpoint
CREATE TRIGGER staff_insert_scope BEFORE INSERT ON staff_members WHEN NEW.branch_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'invalid_branch_scope') WHERE NOT EXISTS (SELECT 1 FROM branches WHERE id=NEW.branch_id AND cafe_id=NEW.cafe_id);
END;
--> statement-breakpoint
CREATE TRIGGER staff_update_scope BEFORE UPDATE ON staff_members WHEN NEW.branch_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'invalid_branch_scope') WHERE NOT EXISTS (SELECT 1 FROM branches WHERE id=NEW.branch_id AND cafe_id=NEW.cafe_id);
END;
