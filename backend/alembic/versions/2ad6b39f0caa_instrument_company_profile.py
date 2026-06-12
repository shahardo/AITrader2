"""instrument company profile fields

Revision ID: 2ad6b39f0caa
Revises: 17acd9f83ab6
Create Date: 2026-06-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2ad6b39f0caa'
down_revision: Union[str, Sequence[str], None] = '17acd9f83ab6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('instruments', sa.Column('website', sa.String(length=500), nullable=True))
    op.add_column('instruments', sa.Column('description', sa.Text(), nullable=True))
    op.add_column(
        'instruments', sa.Column('profile_fetched_at', sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('instruments', 'profile_fetched_at')
    op.drop_column('instruments', 'description')
    op.drop_column('instruments', 'website')
