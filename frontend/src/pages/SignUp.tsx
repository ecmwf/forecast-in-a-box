"use client";

import { Container, TextInput, PasswordInput, Button, Paper, Title, Notification, Text, Progress, List, ThemeIcon } from '@mantine/core'
import { IconCheck, IconX } from '@tabler/icons-react'

import { useState } from 'react'
import {useApi} from '../api'
import MainLayout from '../layouts/MainLayout';

import { showNotification } from '@mantine/notifications'
import { useNavigate, Link } from 'react-router-dom'

function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters'
  if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter'
  if (!/[a-z]/.test(password)) return 'Password must include a lowercase letter'
  if (!/\d/.test(password)) return 'Password must include a number'
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include a special character'
  return null
}


function calculateStrength(password: string): number {
  let strength = 0
  if (password.length >= 8) strength += 20
  if (/[A-Z]/.test(password)) strength += 20
  if (/[a-z]/.test(password)) strength += 20
  if (/\d/.test(password)) strength += 20
  if (/[^A-Za-z0-9]/.test(password)) strength += 20
  return strength
}

export default function Signup() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')

  const navigate = useNavigate()
  const api = useApi()

  const handleSignup = async () => {
    const passwordError = validatePassword(password)
    setError('')
    if (passwordError) {
      setError(passwordError)
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    try {
      await api.post('/v1/auth/register', { email, password })
      navigate('/login')
    } catch (err) {
      setError('Signup failed. Email might be taken.')
    }
    if (error) {
        showNotification({
            id: `signup-error-form-${crypto.randomUUID()}`,
            position: 'top-right',
            autoClose: 3000,
            title: "Signup Failed",
            message: `${error}`,
            color: 'red',
            loading: false,
        });
    }
  }

  const strength = calculateStrength(password)
  const strengthColor = strength < 60 ? 'red' : strength < 100 ? 'yellow' : 'green'

  const checks = [
    {
      label: 'At least 8 characters',
      valid: password.length >= 8,
    },
    {
      label: 'One uppercase letter',
      valid: /[A-Z]/.test(password),
    },
    {
      label: 'One lowercase letter',
      valid: /[a-z]/.test(password),
    },
    {
      label: 'One number',
      valid: /\d/.test(password),
    },
    {
      label: 'One special character',
      valid: /[^A-Za-z0-9]/.test(password),
    },
  ]

  return (
    <MainLayout>
      <Container size={420} my={40}>
        <Title ta="center" mb="lg">Signup</Title>
        <Paper withBorder shadow="md" p={30} radius="md">
          <TextInput label="Email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} required />
          <PasswordInput label="Password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} required mt="md" />
          <PasswordInput label="Confirm Password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.currentTarget.value)} required mt="md" />
          <Progress value={strength} color={strengthColor} size="xs" mt={5} radius="xl" />
          <List size="xs" spacing="xs" mt="sm">
            {checks.map(({ label, valid }) => (
              <List.Item
                key={label}
                icon={
                  <ThemeIcon color={valid ? 'teal' : 'gray'} size={16} radius="xl">
                    {valid ? <IconCheck size={12} /> : <IconX size={12} />}
                  </ThemeIcon>
                }
              >
                {label}
              </List.Item>
            ))}
          </List>
          <Button fullWidth mt="xl" onClick={handleSignup}>Sign Up</Button>
          {error && <Notification color="red" mt="md">{error}</Notification>}
          <Text ta="center" mt="md" size="sm">
            Already have an account? <Link to="/login">Login</Link>
          </Text>
        </Paper>
      </Container>
      </MainLayout>
  )
}