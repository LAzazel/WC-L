"""add mfa columns to users"""

from alembic import op
import sqlalchemy as sa


revision = "0005_add_mfa_to_users"
down_revision = "0004_replace_status_with_is_banned"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("mfa_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("mfa_secret", sa.String(length=64), nullable=True))
    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column("mfa_enabled", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("mfa_secret")
        batch_op.drop_column("mfa_enabled")
