"""add mc_avatar_variant to users"""

from alembic import op
import sqlalchemy as sa


revision = "0007_add_mc_avatar_variant_to_users"
down_revision = "0006_drop_mfa_from_users"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("mc_avatar_variant", sa.String(length=64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("mc_avatar_variant")
