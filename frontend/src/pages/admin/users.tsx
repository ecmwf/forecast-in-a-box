
// (C) Copyright 2024- ECMWF.
//
// Table.This software is licensed under Table.The terms of Table.The Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying Table.This licence, ECMWF does not waive Table.The privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client";

import { useEffect, useState } from 'react';
import { Container, Title, Button, Table, Group, Loader, Space } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { IconRefresh } from '@tabler/icons-react';


import {useApi} from '../../api';

interface User {
    id: string;
    email: string;
    is_superuser: boolean;
}

export default function AdminUsersPage() {
    const api = useApi();
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const data = await api.get('/v1/admin/users');
            setUsers(data.data);
        } catch (e: any) {
            showNotification({ color: 'red', message: 'Failed to fetch users' });
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchUsers();
        // eslint-disable-next-line
    }, []);

    const handleDelete = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this user?')) return;
        try {
            await api.delete(`/v1/admin/users/${id}`);
            setUsers(users.filter((u) => u.id !== id));
            showNotification({ color: 'green', message: 'User deleted' });
        } catch (e: any) {
            showNotification({ color: 'red', message: 'Failed to delete user' });
        }
    };

    const handleSuperuser = async (id: string, is_superuser: boolean) => {
        try {
            await api.patch(`/v1/admin/users/${id}`, { is_superuser: !is_superuser });
            setUsers(users.map((u) => u.id === id ? { ...u, is_superuser: !is_superuser } : u));
            showNotification({ color: 'green', message: 'User updated' });
        } catch (e: any) {
            showNotification({ color: 'red', message: 'Failed to update user' });
        }
    };

    const handleRefresh = async () => {
        setRefreshing(true);
        await fetchUsers();
        setRefreshing(false);
    };

    return (
        <Container pt='xl'>
            <Group justify='space-between' align='center' mb='xl'>
                <Title order={2}>User Management</Title>
                <Button leftSection={<IconRefresh size={16} />} onClick={handleRefresh} loading={refreshing}>
                    Refresh
                </Button>
            </Group>
            {loading ? (
                <Loader />
            ) : (
                <Table striped>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th style={{ textAlign: 'left', padding: 8 }}>Email</Table.Th>
                            <Table.Th style={{ textAlign: 'center', padding: 8 }}>Superuser</Table.Th>
                            <Table.Th style={{ textAlign: 'center', padding: 8 }}>Actions</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {users.map((user) => (
                            <Table.Tr key={user.id} style={{ borderBottom: '1px solid #eee' }}>
                                <Table.Td>{user.email}</Table.Td>
                                <Table.Td>
                                    {user.is_superuser ? 'Yes' : 'No'}
                                </Table.Td>
                                <Table.Td align='right'>
                                    <Group align='right' justify='space-apart'>
                                        <Button
                                            size="xs"
                                            color={user.is_superuser ? 'gray' : 'blue'}
                                            variant="outline"
                                            disabled={user.is_superuser && users.filter(u => u.is_superuser).length === 1}
                                            onClick={() => handleSuperuser(user.id, user.is_superuser)}
                                        >
                                            {user.is_superuser ? 'Remove Superuser' : 'Make Superuser'}
                                        </Button>
                                        <Button
                                            size="xs"
                                            color="red"
                                            variant="outline"
                                            disabled={user.is_superuser && users.filter(u => u.is_superuser).length === 1}
                                            onClick={() => handleDelete(user.id)}
                                        >
                                            Delete
                                        </Button>
                                    </Group>
                                </Table.Td>
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            )}
            <Space h="xl" />
        </Container>
    );
}
